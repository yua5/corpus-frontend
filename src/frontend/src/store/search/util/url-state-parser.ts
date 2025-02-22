import memoize from 'memoize-decorator';

import BaseUrlStateParser from '@/store/util/url-state-parser-base';
import LuceneQueryParser from 'lucene-query-parser';

import {mapReduce, decodeAnnotationValue, uiTypeSupport, getCorrectUiType, unparenQueryPart, getParallelFieldName, applyWithinClauses, unescapeRegex, spanFilterId} from '@/utils';
import {parseBcql, Attribute, Result, Token} from '@/utils/bcql-json-interpreter';
import parseLucene from '@/utils/luceneparser';
import {debugLog} from '@/utils/debug';

import * as CorpusModule from '@/store/search/corpus';
import * as UIModule from '@/store/search/ui';
import * as HistoryModule from '@/store/search/history';
import * as TagsetModule from '@/store/search/tagset';
import * as QueryModule from '@/store/search/query';
import * as ConceptModule from '@/store/search/form/conceptStore';
import * as GlossModule from '@/store/search/form/glossStore';
import * as UIStore from '@/store/search/ui';

// Form
import * as FilterModule from '@/store/search/form/filters';
import * as InterfaceModule from '@/store/search/form/interface';
import * as PatternModule from '@/store/search/form/patterns';
import * as ExploreModule from '@/store/search/form/explore';
import * as GapModule from '@/store/search/form/gap';

// Results
import * as ViewModule from '@/store/search/results/views';
import * as GlobalResultsModule from '@/store/search/results/global';

import {FilterValue, AnnotationValue} from '@/types/apptypes';

import cloneDeep from 'clone-deep';
import { getValueFunctions } from '@/components/filters/filterValueFunctions';

/**
 * Decode the current url into a valid page state configuration.
 * Keep everything private except the getters
 */
export default class UrlStateParser extends BaseUrlStateParser<HistoryModule.HistoryEntry> {
	/**
	 * MetadataFilters here are the interface components to filter a query by document metadata.
	 * Because these can be fairly complex components, we have decided to implement decoding of the query in the Vue components.
	 * So in order to decode the query, we need knowledge of which filters are configured.
	 * This is done by the FilterModule, so we need that info here.
	 */
	constructor(private registeredMetadataFilters: FilterModule.ModuleRootState, uri?: URI) {
		super(uri);
	}

	@memoize
	public async get(): Promise<HistoryModule.HistoryEntry> {

		// Make sure our parsed cql is up to date (used to be a memoized getter, but we need it to be async)
		await this.updateParsedCql(this.getString('patt', null, v => v ? v : null));

		return {
			explore: this.explore,
			filters: this.filters,
			interface: this.interface,
			patterns: this.patterns,
			gap: this.gap,

			// settings for the active results view
			view: this.view(this.interface.viewedResults),
			global: this.global,
			concepts: this.concepts,
			glosses: this.glosses,
			// submitted query not parsed from url: is restored from rest of state later.
		};
	}

	@memoize
	private get explore(): ExploreModule.ModuleRootState {
		return {
			frequency: this.frequencies || ExploreModule.defaults.frequency,
			ngram: this.ngrams || ExploreModule.defaults.ngram,
			corpora: this.corpora || ExploreModule.defaults.corpora,
		};
	}

	/** Within clauses that can be added to a span filter widget (on the right)
	 *  (and are not already in the within widget on the left)
	 */
	@memoize
	get spanFilters(): Record<string, FilterValue> {
		const result: Record<string, FilterValue> = {};
		Object.entries(this.withinClauses)
			.forEach(([elName, attrs]) => {
				Object.entries(attrs)
					.forEach(([attrName, attrValue]) => {
					const id = spanFilterId(elName, attrName);
					const filter = FilterModule.getState().filters[id];
					const vf = filter ? getValueFunctions(filter) : undefined;
					if (vf?.isSpanFilter) {
						let values: string[];
						if (typeof attrValue === 'string') {
							if (filter.componentName === 'filter-select') {
								// select, decode options
								values = attrValue.split('|').map(v => unescapeRegex(v, { escapeWildcards: false }));
							} else {
								// text
								values = [ unescapeRegex(attrValue, { escapeWildcards: false }) ];
							}
						} else if (attrValue.low || attrValue.high) {
							values = [attrValue.low || '', attrValue.high || ''];
						} else {
							values = [ attrValue ];
						}
						result[id] = { id, values };
					}
				});
		});
		return result;
	}

	/** Within clauses that don't fit into a widget, so must remain part of the Expert query */
	@memoize
	get withinClausesWithoutSpanFilters(): Record<string, Record<string, any>> {
		// Only keep within clauses that are not span filters
		return Object.fromEntries(Object.entries(this.withinClauses)
			.map(([spanName, attrs]: [string, Record<string, any>]) => {
				if (Object.keys(attrs).length === 0) {
					// No attributes, so this might be the within widget selection.
					return [spanName, { '_MAYBE_WITHIN_': true } as Record<string, any>];
				} else {
					const filters = FilterModule.getState().filters;
					const filteredAttrs = Object.fromEntries(Object.entries(attrs)
						.filter(entry => {
							const filter = filters[spanFilterId(spanName, entry[0])];
							const vf = filter ? getValueFunctions(filter) : undefined;
							return !vf?.isSpanFilter;
						}));
					if (Object.keys(attrs).length > 0 && Object.keys(filteredAttrs).length === 0) {
						// All attributes were placed in span filters, so we probably don't want this
						// to be the within widget selection.
						return [spanName, { } as Record<string, any>];
					} else {
						return [spanName, filteredAttrs as Record<string, any>];
					}
				}
			})
			.filter(([elName, attrs]: [string, Record<string, any>]) => Object.keys(attrs).length > 0)
			.map(([elName, attrs]: [string, Record<string, any>]) => [elName, attrs['_MAYBE_WITHIN_'] ? {} : attrs])) as Record<string, Record<string, any>>;
	}

	@memoize
	private get filters(): FilterModule.ModuleRootState {
		const luceneString = this.getString('filter', null, v=>v?v:null);
		const spanFilters = this.spanFilters;
		if (luceneString == null && Object.keys(spanFilters).length === 0) {
			return {};
		}

		try {
			// FIXME: code below claims to be important but is never used!?
			const metadataFields = CorpusModule.get.allMetadataFieldsMap();
			const filterDefinitions = FilterModule.getState().filters;
			const allFilters = Object
				.keys(filterDefinitions) // IMPORTANT: have "special" filters (that don't "own" their metadata field) first
				.filter(id => metadataFields[id] == null) // that way, they can delete values from the filtervalues and prevent other filters from parsing those values as well, which would lead to the filter being "doubled" on url decode
				.concat(UIModule.getState().search.shared.searchMetadataIds)

			const filterValues: Record<string, FilterModule.FullFilterState> = {};

			const luceneQueryAST = luceneString ? LuceneQueryParser.parse(luceneString) : null;
			const parsedQuery: Record<string, FilterValue> = {
				...(luceneString ? mapReduce(parseLucene(luceneString), 'id') : {}),
				...this.spanFilters  // also include span filters like "within <speech person='Einstein'/>"
			};
			Object.values(FilterModule.getState().filters).forEach(filterDefinition => {
				const valueFuncs = getValueFunctions(filterDefinition);
				let value: unknown = valueFuncs.decodeInitialState ? valueFuncs.decodeInitialState(
					filterDefinition.id,
					filterDefinition.metadata,
					parsedQuery,
					luceneQueryAST
				) : null;

				if (value) {
					filterValues[filterDefinition.id] = {
						...filterDefinition,
						value,
					}
				}
			});
			return filterValues;
		} catch (error) {
			debugLog('Cannot decode lucene query ', luceneString, error);
			return {};
		}
	}

	/**
	 * Return the frequency form state, if the query fits in there in its entirity.
	 * Null is returned otherwise.
	 */
	@memoize
	private get frequencies(): null|ExploreModule.ModuleRootState['frequency'] {
		if (this.expertPattern.query !== '[]' || this.groupBy.length !== 1) {
			return null;
		}

		const group = this.groupBy[0];
		if (!group.startsWith('hit:')) {
			return null;
		}

		const annotationId = group.substring(4);
		if (!CorpusModule.get.allAnnotationsMap().hasOwnProperty(annotationId)) {
			return null;
		}

		return { annotationId };
	}

	@memoize
	private get interface(): InterfaceModule.ModuleRootState {
		try {
			const uiStateFromUrl: Partial<InterfaceModule.ModuleRootState>|null = JSON.parse(this.getString('interface', null, v => v.startsWith('{')?v:null)!);
			if (!uiStateFromUrl) {
				throw new Error('No url ui state, falling back to determining from rest of parameters.');
			}
			if (!UIModule.getState().search.advanced.enabled && uiStateFromUrl.form === 'search' && uiStateFromUrl.patternMode === 'advanced') {
				uiStateFromUrl.patternMode = 'expert';
			}
			return {
				...InterfaceModule.defaults,
				...uiStateFromUrl,
				// This is not contained in the 'interface' query parameters, but in the path segments of the url.
				// hence decode seperately.
				viewedResults: this.viewedResults
			};
		} catch (e) {
			// Can't parse from url, instead determine the best state based on other parameters.
			const ui = InterfaceModule.defaults;

			// show the pattern view that can hold the query
			// the other views will have the query placed in it as well (if it fits), but this is more of a courtesy
			// if no pattern exists, show the simplest search
			const hasFilters = Object.keys(this.filters).length > 0;
			const hasGapValue = !!this.gap.value; // Only supported for expert view for, prevent setting anything else for now
			let fromPattern = true; // is interface state actually from the pattern, or from the default fallback?
			if (this.simplePattern && !hasFilters && !hasGapValue) {
				ui.patternMode = 'simple';
			} else if ((Object.keys(this.extendedPattern.annotationValues).length > 0) && !hasGapValue) {
				ui.patternMode = 'extended';
			} else if (this.advancedPattern.query && !hasGapValue && UIModule.getState().search.advanced.enabled) {
				ui.patternMode = 'advanced';
			} else if (this.expertPattern.query) {
				ui.patternMode = 'expert';
			} else {
				ui.patternMode = hasFilters ? hasGapValue ? 'expert' : 'extended' : 'simple';
				fromPattern = false;
			}

			// Open any results immediately?
			ui.viewedResults = this.viewedResults;

			// Explore forms have priority over normal search form
			if (this.frequencies != null) {
				ui.form = 'explore';
				ui.exploreMode = 'frequency';
			} else if (this.ngrams != null && !(fromPattern && ui.patternMode === 'simple')) {
				ui.form = 'explore';
				ui.exploreMode = 'ngram';
			} else if (this.corpora != null) {
				ui.form = 'explore';
				ui.exploreMode = 'corpora';
			}

			return ui;
		}
	}

	@memoize
	private get gap(): GapModule.ModuleRootState {
		const value = this.getString('pattgapdata');
		return value ? { value } : GapModule.defaults;
	}

	/** Usually hits or docs, but might be null if no results currently viewed. May also be something different if custom views were registered. */
	@memoize
	private get viewedResults(): string|null {
		// paths are already decoded, and have the base portion removed, so we can just use them directly
		if (this.paths[1] === 'search' && this.paths.length === 3)
			return this.paths[2] || null; // hits or docs, or custom view

		return null;
	}

	/**
	 * Return the ngram form state, if the query fits in there in its entirity.
	 * Null is returned otherwise.
	 */
	@memoize
	private get corpora(): null|ExploreModule.ModuleRootState['corpora'] {
		if (this.viewedResults !== 'docs') {
			return null;
		}

		if (this.groupBy.length === 0) {
			return null;
		}

		if (this.expertPattern.query) {
			return null;
		}

		return {
			groupBy: this.groupBy[0],
			groupDisplayMode: this.view('docs').groupDisplayMode || ExploreModule.defaults.corpora.groupDisplayMode
		};
	}

	/**
	 * Return the ngram form state, if the query fits in there in its entirity.
	 * Null is returned otherwise.
	 */
	@memoize
	private get ngrams(): null|ExploreModule.ModuleRootState['ngram'] {
		const allAnnotations = CorpusModule.get.allAnnotationsMap();

		if (this.groupBy.length === 0) {
			return null;
		}

		const group = this.groupBy[0];
		if (!group.startsWith('hit:')) {
			return null;
		}

		const groupAnnotationId = group.substring(4);
		if (!allAnnotations[groupAnnotationId]) {
			return null;
		}

		if (this._parsedCql == null || this._parsedCql.length > 1)
			return null; // no query, or parallel query; can't interpret as ngram

		const cql = this._parsedCql[0];
		if ( // all tokens need to be very simple [annotation="value"] tokens.
			!cql ||
			cql.withinClauses && Object.keys(cql.withinClauses).length > 0 ||
			cql.targetVersion ||
			cql.tokens === undefined || cql.tokens.length > ExploreModule.defaults.ngram.maxSize ||
			cql.tokens.find(t =>
				t.leadingXmlTag != null ||
				t.trailingXmlTag != null ||
				(t.repeats != null && (t.repeats.min !== 1 || t.repeats.max !== 1)) ||
				t.optional ||
				(t.expression != null && (t.expression.type !== 'attribute' || t.expression.operator !== '='))
			) != null
		) {
			return null;
		}

		// Alright, seems we're all good.
		const defaultNgramTokenAnnotation = ExploreModule.defaults.ngram.tokens[0].id;
		return {
			groupAnnotationId,
			maxSize: ExploreModule.defaults.ngram.maxSize,
			size: cql.tokens.length,
			tokens: cql.tokens.map(t => {
				const valueAnnotationId = t.expression ? (t.expression as Attribute).name : defaultNgramTokenAnnotation;
				const type = getCorrectUiType(uiTypeSupport.explore.ngram, allAnnotations[valueAnnotationId].uiType);

				return {
					// when expression is undefined, the token was just '[]' in the query, so set it to defaults.
					id: valueAnnotationId,
					value: t.expression ? decodeAnnotationValue((t.expression as Attribute).value, type).value : '',
				};
			}),
		};
	}

	@memoize
	private get patterns(): PatternModule.ModuleRootState {
		return {
			shared: this.shared,
			simple: this.simplePattern,
			extended: this.extendedPattern,
			advanced: this.advancedPattern,
			concept: this.conceptPattern,
			glosses: this.glossPattern,
			expert: this.expertPattern,
		};
	}

	@memoize
	private get global(): GlobalResultsModule.ExternalModuleRootState {
		return {
			pageSize: this.pageSize,
			sampleMode: this.sampleMode,
			sampleSeed: this.sampleSeed,
			sampleSize: this.sampleSize,
			context: this.context
		};
	}

	@memoize
	private get pageSize(): number {
		return this.getNumber('number', GlobalResultsModule.defaults.pageSize, v => [20,50,100,200].includes(v) ? v : GlobalResultsModule.defaults.pageSize)!;
	}

	@memoize
	private get annotationValues(): {[key: string]: AnnotationValue} {
		// How we parse the cql pattern depends on whether a tagset is available for this corpus, and whether it's enabled in the ui
		if (!(TagsetModule.getState().state === 'loaded' || TagsetModule.getState().state === 'disabled')) {
			throw new Error('Attempting to parse url before tagset is loaded or disabled, await tagset.awaitInit() before parsing url.');
		}

		if (this._parsedCql === null) {
			return {}; // no query; can't interpret as annotation values
		}

		const result = this._parsedCql[0];
		if (result == null || result.tokens === undefined) {
			return {};
		}

		const tagsetInfo = TagsetModule.getState().state === 'loaded' ? {
			mainAnnotations: CorpusModule.get.allAnnotations().filter(a => a.uiType === 'pos').map(a => a.id),
			subAnnotations: Object.keys(TagsetModule.getState().subAnnotations)
		} : null;

		try {
			/**
			 * A requirement of the PropertyFields/Annotations is that there are no gaps in the values
			 * So a valid config is
			 * ```
			 * lemma: [these, are, words]
			 * word: [these, are, other, words]
			 * ```
			 * And an invalid config is
			 * ```
			 * lemma: [gaps, are, , not, allowed]
			 * ```
			 * Not all properties need to have the same number of values though,
			 * shorter lists are implicitly treated as having wildcards for the remainder of values. (see getPatternString())
			 *
			 * Store the values here while parsing.
			 */
			const knownAnnotations = CorpusModule.get.allAnnotationsMap();

			const annotationValues: {[key: string]: string[]} = {};
			for (let i = 0; i < result.tokens.length; ++i) {
				const token: Token = result.tokens[i];
				if (token.leadingXmlTag || token.optional || token.repeats || token.trailingXmlTag) {
					throw new Error('Token contains settings too complex for simple search');
				}

				// Use a stack instead of direct recursion to simplify code
				const stack = token.expression ? [token.expression] : [];
				while (stack.length) {
					const expr = stack.shift()!;
					if (expr.type === 'attribute') {
						const name = expr.name;
						if (knownAnnotations[name] == null) {
							debugLog(`Encountered unknown cql field ${name} while decoding query from url, ignoring.`);
							continue;
						}

						const isMainTagsetAnnotation = tagsetInfo && tagsetInfo.mainAnnotations.includes(name);
						const isTagsetAnnotation = isMainTagsetAnnotation || (tagsetInfo && tagsetInfo.subAnnotations.includes(name));

						if (isTagsetAnnotation) {
							// add value as original cql-query substring to the main tagset annotation under which the values should be stored.
							debugLog('Relocating value for annotation ' + name + ' to tagset annotation(s) ' + tagsetInfo!.mainAnnotations);
							const originalValue = `${name}="${expr.value}"`;

							for (const id of tagsetInfo!.mainAnnotations) {
								const valuesForAnnotation = annotationValues[id] = annotationValues[id] || [];
								// keep main annotation at the start
								isMainTagsetAnnotation ? valuesForAnnotation.unshift(originalValue) : valuesForAnnotation.push(originalValue);
							}
						} else {
							// otherwise just store wherever it should be in the store.
							const values = annotationValues[name] = annotationValues[name] || [];
							if (expr.operator !== '=') {
								throw new Error(`Unsupported comparator for property ${name} on token ${i} for query ${this.expertPattern}, only "=" is supported.`);
							}
							if (values.length !== i) {
								throw new Error(`Property ${name} contains gaps in value for query ${this.expertPattern}`);
							}
							values.push(expr.value);
						}

					} else if (expr.type === 'binaryOp') {
						if (!(expr.operator === '&' || expr.operator === 'AND')) {
							throw new Error(`Properties on token ${i} are combined using unsupported operator ${expr.operator} in query ${this.expertPattern}, only AND/& operator is supported.`);
						}

						stack.push(expr.left, expr.right);
					}
				}
			}

			// Now we have extracted all raw cql-escaped values for all annotations, and validated the shape of the query
			// decode the values back into their textual representation (i.e. without regex escaping joined back into a single string and such)
			const decodedValues = Object.entries(annotationValues).map(([id, values]) => {
				const annot = knownAnnotations[id];
				if (tagsetInfo && tagsetInfo.mainAnnotations.includes(id)) {
					// use value as-is, already contains cql and should not have wildcards substituted.
					debugLog('Mapping tagset annotation back to cql: ' + id + ' with values ' + values);

					return {
						id,
						case: false,
						value: values.join('&'),
					};
				}

				return {
					id,
					...decodeAnnotationValue(values, annot.uiType)
				};
			});
			return mapReduce(decodedValues, 'id');
		} catch (error) {
			debugLog('Cql query could not be placed in extended view', error);
			return {};
		}
	}

	@memoize
	private get withinElementName(): string|null {
		// Determine selected option in within widget from within clauses in the query
		const withinUi = UIStore.getState().search.shared.within;
		// Note that the first withinOption we find that is in withinClauses is assumed to be the
		// selected within option.
		// FIXME: It's possible that we select the wrong withinOption this way. If we do, and there's
		// no span filter widget to populate with what would have been the correct within option, that
		// part of the query gets dropped on page reload, breaking the user's query...
		// Complex additional logic might improve this slightly, but the real fix is to change the URL to describe
		// the frontend's interface state, not the query we send to BLS.
		const withinOptions = withinUi.enabled ?
			withinUi.elements.filter(element => UIModule.corpusCustomizations.search.within.includeSpan(element.value)) : [];
		return withinOptions.find(opt => !!this.withinClausesWithoutSpanFilters[opt.value])?.value ?? null;
	}

	@memoize
	private get withinAttributes(): Record<string, any> {
		// Find any attributes for the within widget
		const within = this.withinElementName;
		const allAttributes = within ? this.withinClausesWithoutSpanFilters[within] ?? {} : {};
		const attributesAcceptedByWithinWidget = within ?
			(UIModule.corpusCustomizations.search.within._attributes(within) || [])
			.map(el => typeof el === 'string' ? { value: el } : el) : [];
		const withinAttributes = Object.fromEntries(Object.entries(allAttributes)
			.filter(([attrName, attrValue]) => {
				return !!attributesAcceptedByWithinWidget.find(w => w.value === attrName);
			})
			.map(([attrName, attrValue]) => [attrName, unescapeRegex(attrValue, { escapeWildcards: false })]));
		return withinAttributes;
	}

	@memoize
	private get expertWithinClauses(): Record<string, Record<string, any>> {
		// Remove whatever goes into the within widget from the withinClauses.
		const within = this.withinElementName;
		const withinAttributes = this.withinAttributes;
		return Object.fromEntries(Object.entries(this.withinClausesWithoutSpanFilters)
			.map(([el, attr]) => {
				if (el === within) {
					// Remove attributes that are already in the within widget
					Object.keys(withinAttributes).forEach(attrName => delete attr[attrName]);
				}
				return [el, attr];
			})) as Record<string, Record<string, any>>;
	}

	@memoize
	private get shared() {
		// The query typically doesn't contain the entire parallel field name.
		// BlackLab allows passing just "en" instead of "contents__en" in some spots
		// So we need to reconstruct the full field name from the query here.
		const prefix = CorpusModule.get.parallelFieldPrefix();

		const parallelFieldsMap = CorpusModule.get.parallelAnnotatedFieldsMap();

		// It used to be that sourceField was only the version suffix, but now it's the full field name
		// So we need to check if the source field is a valid parallel field name, and if not, try to find the correct one
		// For interop with legacy urls (which shouldn't be in production, but might be floating around in test docs).
		let source = this.getString('field', null, v => v ? v : null);
		if (source && !parallelFieldsMap[source]) {
			source = getParallelFieldName(prefix, source);
			if (!parallelFieldsMap[source]) {
				console.info(`Invalid parallel source field name in url (${this.getString('field')}), ignoring`);
				source = null;
			}
		}
		const targets = this._parsedCql ? this._parsedCql.slice(1)
			.map(result => result.targetVersion ? getParallelFieldName(prefix, result.targetVersion) : '') : [];

		// Determine align by (relation type in BCQL query, e.g. for "the" -word-alignment->nl _ it would be "word-alignment")
		const defaultAlignBy = UIModule.getState().search.shared.alignBy.defaultValue;
		const alignBy = (this._parsedCql ? this._parsedCql[1]?.relationType : defaultAlignBy) ?? defaultAlignBy;

		return {
			source,
			targets,
			alignBy,
			within: this.withinElementName,
			withinAttributes: this.withinAttributes
		};
	}

	@memoize
	private get simplePattern() {
		// Simple view is just a single annotation without any within query or filters
		// NOTE: do not use extendedPattern, as the annotation used for simple may not be available for extended searching!
		return {
			annotationValue: this.annotationValues[CorpusModule.get.firstMainAnnotation().id] || {}
		};
	}

	@memoize
	private get extendedPattern() {
		const annotationsInInterface = mapReduce(UIModule.getState().search.extended.searchAnnotationIds);
		const parsedAnnotationValues = cloneDeep(this.annotationValues);
		Object.keys(parsedAnnotationValues).forEach(annotId => {
			if (!annotationsInInterface[annotId]) {
				delete parsedAnnotationValues[annotId];
			}
		});

		return {
			annotationValues: parsedAnnotationValues,

			// This is always false, it's just a checkbox that will split up the query when it's submitted, then untick itself
			splitBatch: false
		};
	}

	@memoize
	private get advancedPattern() {
		return this._parsedCql ? this.expertPattern : { query: null, targetQueries: [] };
	}

	@memoize
	private get conceptPattern(): string|null { // Jesse
		return this.getString('patt', null, v=>v?v:null); // TODO dit zal wel anders moeten
	}

	@memoize
	private get glossPattern(): string|null { // Jesse
		return this.getString('patt', null, v=>v?v:null); // TODO dit zal wel anders moeten
	}

	@memoize
	private get expertPattern() {

		// In parallel queries, if any of the queries amounts to "zero or more of any token",
		// just leave it empty.
		const isParallel = (this._parsedCql?.length ?? 0) > 1;
		const optEmpty = (q: string|undefined) => isParallel && (q === undefined || q === '_' || q === '[]*') ? '' : q;

		// Strip any withinClauses from the end of the CQL query,
		// then add back only those that we cannot place into a widget.
		function stripWithins(q: string) {
			return q.replace(/(?:\s*(?:within|overlap)?\s*<[^\/]+\/>)+$/g, '');
		}
		const hasWithinClauses = this._parsedCql && this._parsedCql[0].withinClauses && Object.keys(this._parsedCql[0].withinClauses).length > 0;
		const query = unparenQueryPart(hasWithinClauses ? stripWithins(this._parsedCql![0].query ?? '') : this._parsedCql?.[0].query ?? '');
		const reapplyWithins = this.expertWithinClauses;
		console.log('reapplyWithins', reapplyWithins);
		const finalQuery = Object.keys(reapplyWithins).length > 0 ? applyWithinClauses(query ?? '', reapplyWithins) : query;

		return {
			query: this._parsedCql ? optEmpty(unparenQueryPart(finalQuery)) || null : null,
			targetQueries: this._parsedCql ? this._parsedCql.slice(1).map(r => optEmpty(unparenQueryPart(r.query)) || '') : [],
		};
	}

	@memoize
	private get concepts(): ConceptModule.HistoryState {
		return {
			main_fields: [],
			query: [[],[]],
			query_cql: this.conceptPattern ||'',
			target_element: '',
		}
	}

	@memoize
	private get glosses(): GlossModule.HistoryState {
		return {
			current_page: [],
			gloss_query: {
				corpus: '',
				parts: {}
			},
			gloss_query_cql: '',
			glosses: {},
		}
	}

	@memoize
	private get sampleMode(): 'count'|'percentage' {
		// If 'sample' exists we're in count mode, otherwise if 'samplenum' (and is valid), we're in percent mode
		// ('sample' also has precendence for the purposes of determining samplesize)
		if (this.getNumber('samplenum') != null) {
			return 'count';
		} else if (this.getNumber('sample', null, v => (v != null && (v >= 0 && v <=100)) ? v : null) != null) {
			return 'percentage';
		} else {
			return GlobalResultsModule.defaults.sampleMode;
		}
	}

	@memoize
	private get sampleSeed(): number|null {
		return this.getNumber('sampleseed', null);
	}

	@memoize
	private get sampleSize(): number|null {
		// Use 'sample' unless missing or not 0-100 (as it's percentage-based), then use 'samplenum'
		const sample = this.getNumber('sample', null, v => v != null && v >= 0 && v <= 100 ? v : null);
		return sample != null ? sample : this.getNumber('samplenum', null);
	}

	// TODO these might become dynamic in the future, then we need extra manual checking to see if the value is even supported in this corpus
	@memoize
	private get withinClauses(): Record<string, Record<string, any>> {
		return this._parsedCql?.[0].withinClauses ?? {};
	}

	@memoize
	private get context(): number|null {
		return this.getNumber('context', null, v => v != null && v >= 0 && v <= 10 ? v : null);
	}

	@memoize
	private get groupBy(): string[] {
		return this.getString('group', '')!
		.split(',')
		.map(g => g.trim())
		.filter(g => !!g);
	}

	@memoize
	private get caseSensitive(): boolean {
		const groups = this.groupBy.filter(g => !g.startsWith('context:'));

		return groups.length > 0 && groups.every(g => g.endsWith(':s'));
	}

	/**
	 * Get the state for a specific view.
	 * Or when a custom module has been defined, the custom module.
	 * @param view
	 * @returns
	 */
	private view(view?: string|null): ViewModule.ViewRootState { // they're the same anyway.
		if (this.viewedResults !== view) {
			return cloneDeep(ViewModule.initialViewState);
		}

		return {
			customState: JSON.parse(this.getString('resultViewCustomState', 'null', v => v ?? 'null')!),
			groupBy: this.groupBy,
			sort: this.getString('sort', null, v => v?v:null),
			viewGroup: this.getString('viewgroup', undefined, v => (v && this.groupBy.length > 0)?v:null),
			page: this.getNumber('first', 0, v => Math.floor(Math.max(0, v)/this.pageSize)/* round down to nearest page containing the starting index */)!,
			groupDisplayMode: this.getString('groupDisplayMode', null, v => v?v:null),
		};
	}

	// ------------------------
	// Some intermediate values
	// ------------------------

	private async updateParsedCql(bcql: string|null) {
		try {
			this._parsedCql = bcql == null ? null :
				await parseBcql(INDEX_ID, bcql, CorpusModule.get.firstMainAnnotation().id);
			if (this._parsedCql && this._parsedCql.length === 0)
				this._parsedCql = null;
			if (this._parsedCql && this._parsedCql.length > 1) {
				const relType = this._parsedCql[1].relationType;
				// Check if this is a valid alignBy type
				const alignBy = UIModule.getState().search.shared.alignBy.elements.find(v => v.value === relType);
				const optional = this._parsedCql[1].optional ?? false;
				if (!alignBy || !optional) {
					// Not a valid align by type, or a required alignment match; just put the whole query in the first expert box
					this._parsedCql = [
						{
							query: bcql || ''
						}
					];
				}
			}
		} catch (e) {
			// Just accept that we cannot interpret it for use in the simple, extended or advanced
			// search modes, and use the entire query for the Expert view.
			this._parsedCql = [
				{
					query: bcql || ''
				}
			];
		}
	}

	_parsedCql: Result[]|null = null;
}
