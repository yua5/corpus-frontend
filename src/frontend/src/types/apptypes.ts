import * as BLTypes from '@/types/blacklabtypes';

// -----------
// State types
// -----------

/** Property of a word, usually 'lemma', 'pos', 'word' */
export type NormalizedAnnotation = {
	/** id of the field this annotation resides in, usually 'contents' */
	annotatedFieldId: string;
	caseSensitive: boolean;
	description: string;
	displayName: string;
	hasForwardIndex: boolean;
	/** 'lemma', 'pos', etc. These are only unique within the same annotatedField */
	id: string;
	isInternal: boolean;
	/**
	 * True if this is the default annotation that is matched when a cql query does not specify the field
	 * (e.g. just "searchTerm" instead of [fieldName="searchTerm"]
	 */
	isMainAnnotation: boolean;
	offsetsAlternative: string;
	/** When this is a subAnnotation */
	parentAnnotationId?: string;
	/** List of annotationIds in the same annotatedField, only present when the field has actual subAnnotations */
	subAnnotations?: string[];
	/** Based on the uiType of the original annotion, but select falls back to combobox if not all values are known */
	uiType: 'select'|'combobox'|'text'|'pos'|'lexicon';
	/** Contains all known values for this field. Undefined if no values known or list was incomplete. */
	values?: Array<{value: string, label: string, title: string|null}>;
};

/** A set of annotations that form one data set on a token, usually there is only one of these in an index, called 'content' */
export type NormalizedAnnotatedField = {
	annotations: { [annotationId: string]: NormalizedAnnotation };
	description: string;
	displayName: string;
	hasContentStore: boolean;
	hasLengthTokens: boolean;
	hasXmlTags: boolean;
	/** usually 'contents', annotatedFieldId in NormalizedAnnotation refers to this */
	id: string;
	isAnnotatedField: boolean;
	/**
	 * If a cql query is fired that is just a string in quotes (such as "searchterm")
	 * this is the id of the annotation that is searched, usually the annotation with id 'word'.
	 * Refers to the id of a NormalizedAnnotation
	 */
	mainAnnotationId: string;
};

export type NormalizedMetadataField = {
	description: string;
	displayName: string;
	// /** Id of the metadataFieldGroup, if part of a group */
	// groupId?: string;
	id: string;
	/**
	 * Based on the uiType of the original metadata field,
	 * but 'select' is replaced by 'combobox' if not all values are known.
	 * Unknown types are replaced by 'text'
	 */
	uiType: 'select'|'combobox'|'text'|'range'|'checkbox'|'radio'|'date';
	/** Only when uiType === 'select' */
	values?: Array<{value: string, label: string, title: string|null}>;
};

export type NormalizedAnnotationGroup = {
	/** Id of the parent annotated field, required as annotation IDs are not unique across fields. */
	annotatedFieldId: string;
	/** Unique within groups with the same annotatedFieldId, treat as a user-friendly name. */
	id: string;
	/**
	 * Pre-sorted (see blacklabUtils::normalizeIndex):
	 * - by whatever is defined in blacklab though the indexconfig.yaml if groups are defined there.
	 * - based on the displayOrder of annotations in the parent annotatedField if no groups are defined.
	 * - sorted by the annotations' displayNames if the index is old and does not support displayOrder.
	 *
	 * May contain internal annotations if defined through indexconfig.yaml.
	 * If autogenerated by this front-end, does not contain internal annotations.
	 */
	entries: string[];
	/**
	 * For the group containing all remainder annotations
	 * Unless configured otherwise, annotations in the remainder group are not shown or used in the interface.
	 */
	isRemainderGroup: boolean;
};

export type NormalizedMetadataGroup = {
	/** Unique within groups with the same annotatedFieldId, treat as a user-friendly name. */
	id: string;
	/** Keys in metadataFields */
	entries: string[];
	/**
	 * For the group containing all remainder metadata fields.
	 * Unless configured otherwise, fields in the remainder group are not shown or used in the interface.
	 */
	isRemainderGroup: boolean;
};

/** A smaller version of the index object without actual description of the contents. */
export type NormalizedIndexBase = {
	/** Description as set by the creator */
	description: string;
	/** A user-friendly name, excluding the name of the owner (if any). */
	displayName: string;
	/** key of a BLFormat */
	documentFormat?: string;
	/** Id of this index. Contains the username if this is a user-owned index. (username:indexname) */
	id: string;
	/** Progress of indexing new documents, if currently indexing. Null otherwise. */
	indexProgress: BLTypes.BLIndexProgress|null;
	/** Owner of the corpus, if is a user owned corpus */
	owner: string|null;
	/** Whether the index is indexing new documents or is available for searching, etc. */
	status: BLTypes.BLIndex['status'];
	/** yyyy-mm-dd hh:mm:ss */
	timeModified: string;
	/** Number of tokens in this index (excluding those tokens added in any currently running indexing action). */
	tokenCount: number;
	/** Number of documents in this index excluding those tokens added in any currently running indexing action). */
	documentCount: number;
}

/** Contains information about the internal structure of the index - which fields exist for tokens, which metadata fields exist for documents, etc */
export type NormalizedIndex = NormalizedIndexBase&{
	annotatedFields: { [id: string]: NormalizedAnnotatedField; };
	/** Key info annotatedFields */
	mainAnnotatedField: string;
	/**
	 * If no groups are defined by blacklab itself, all annotations of all annotatedFields are placed in generated groups.
	 * Note that an annotation may be part of more than one group.
	 * Sorted in order of appearance.
	 */
	annotationGroups: NormalizedAnnotationGroup[];
	contentViewable: boolean;
	/** If -1, the blacklab version is too old to support this property, and it needs to be requested from the server. (we do this on app startup, see corpusStore). */
	documentCount: number;

	fieldInfo: BLTypes.BLDocFields;

	/**
	 * If no groups are defined by blacklab itself, all metadata fields are placed in a single group called 'Metadata'.
	 * Note that a single field may be part of more than one group.
	 * Sorted in order of appearance.
	 */
	metadataFieldGroups: NormalizedMetadataGroup[];
	metadataFields: { [key: string]: NormalizedMetadataField; };

	textDirection: 'ltr'|'rtl';
};

// Helper - get all props in A not in B
type Subtract<A, B> = Pick<A, Exclude<keyof A, keyof B>>;

interface INormalizedFormat {
	// new props
	id: string;
	/** Username extracted */
	owner: string|null;
	/** internal name extracted */
	shortId: string;

	// original props, with normalized values
	/** Null if would be empty originally */
	helpUrl: string|null;
	/** Null if would be empty originally */
	description: string|null;
	/** set to shortId if originally empty */
	displayName: string;
}
export type NormalizedFormat = INormalizedFormat & Subtract<BLTypes.BLFormat, INormalizedFormat>;

// ------------------
// Types used on page
// ------------------

/**
 * In the central Vuex store, this object represents the value of an "annotation" e.g. word/lemma/pos
 */
export type AnnotationValue = {
	/** Unique id of the annotated field  */
	// readonly annotatedFieldId: string;

	/** Unique ID of the property */
	readonly id: string;
	/** Raw value of the property */
	value: string;
	/** Should the property match using case sensitivity */
	case: boolean;
	/**
	 * Type of the annotation.
	 * Some types require special treatment when parsing or serializing from/to cql.
	 * Always available, but not required to allow committing new values to the store without setting it.
	 */
	readonly type?: NormalizedAnnotation['uiType'];
};

export type FilterValue = {
	/** Unique id of the metadata field */
	readonly id: string;
	/**
	 * Type of the filter, determines how the values are interpreted and read from the DOM
	 * See CorpusConfig.java/search.vm
	 *
	 * 'range' -> has two numerical inputs, min and max
	 * 'select' -> is a multiselect field
	 *
	 * There is also 'combobox' and 'text',
	 * but these are just a regular text input (with some autocompletion on combobox)
	 * and can be treated the same way for the purposes of state and DOM manipulation
	 *
	 * It's possible for a user to specify another type (using uiType for annotatedFields and metadataFields in the index format),
	 * but this should just be ignored and treated as 'text'.
	 */
	// type: NormalizedMetadataField['uiType'];
	/** Values of the filter, for selects, the selected values as array elements, for text, the text as the first array element, for ranges the min and max values in indices [0][1] */
	values: string[];
};

/** Everything a filter needs to be rendered. Name of the component, the ID (to connect to the vuex store), list of possible values (when relevant), etc. */
export type FilterDefinition<MetadataType = any, ValueType = any> = {
	/** Id of the filters, this must be unique */
	id: string;
	displayName: string;
	description?: string;
	/** Name of the component, for filters generated from the blacklab index metadata, `filter-${uiType}` */
	componentName: string;
	/** The group this filter is part of, only for ui purposes. */
	groupId?: string;
	/**
	 * Other info the filter component may require, such as options in a dropdown list for a filter of type Select.
	 * This is usually empty for the normal text, range, autocomplete types. But for select, radio, and checkbox this contains the available options.
	 * For 'pos' this contains the tagset.
	 * Custom filter types may place whatever data they require here and it will be made available as a prop.
	 */
	metadata: any;
};

// TODO remove groupby settings
// We re-implemented the grouping windows, it uses GroupBySettings2, which is a more flexible version of GroupBySettings
// The old GroupBySettings is still used in the legacy component, but it should be removed probably.
// The context settings should completely be removed,

/**
 * Settings for grouping by annotations in/around the hit.
 * See http://inl.github.io/BlackLab/server/rest-api/corpus/hits/get.html#criteria-for-sorting-grouping-and-faceting
*/
export type GroupByContextSettings = {
	type: 'annotation';
	annotation: string;
	caseSensitive: boolean;
	position: 'L'|'R'|'H'|'E';
	/** 1-indexed inclusive */
	start: number;
	/** 1-indexed inclusive */
	end?: number;
}

export type GroupByMetadataSettings = {
	type: 'metadata';
	field: string;
	caseSensitive: boolean;
}

export type GroupByCaptureSettings = {
	type: 'capture';
	annotation: string;
	caseSensitive: boolean;
	groupname: string;
}

export type GroupBySettings = GroupByContextSettings|GroupByMetadataSettings|GroupByCaptureSettings;

// ---------------
// Hits displaying
// ---------------

export type CaptureAndRelation = {
	/** css color in the form of rgb(x,y,z) */
	color: string;
	/** Because background color might be dark, in that case text should be white */
	textcolor: string;
	/** name of the capture group, or set of relation. */
	key: string;
	/** value of captured info, or value of relation. */
	value: string;
	/** true if this is a relation source */
	isSource: boolean;
	/** true if this is a relation target */
	isTarget: boolean;
}
export type HitToken = {
	text: string;
	/** after the text */
	punct: string;
	captureAndRelation?: CaptureAndRelation[];
}

/** Interop between blacklab Hit objects and the UI. */
export type HitContext = {
	before: HitToken[];
	match: HitToken[];
	after: HitToken[];
}

// -------------------
// Configuration types
// -------------------

export type Tagset = {
	/** Referring to the annotation for which the values exist, this is the annotation under which the main part-of-speech category is stored ('ww', 'vnw' etc) */
	// annotationId: string;
	/**
	 * All known values for this annotation.
	 * The raw values can be gathered from blacklab
	 * but displaynames, and the valid constraints need to be manually configured.
	 */
	values: {
		[key: string]: {
			value: string;
			displayName: string;
			/** All subannotations that can be used on this type of part-of-speech */
			subAnnotationIds: string[];
		}
	};
	/**
	 * All subannotations of the main annotation
	 * Except the displayNames for values, we could just autofill this from blacklab.
	 */
	subAnnotations: {
		[key: string]: {
			id: string;
			/** The known values for the subannotation */
			values: Array<{
				value: string;
				displayName: string;
				/** Only allow/show this specific value for the defined main annotation values (referring to Tagset['values'][key]) */
				pos?: string[];
			}>;
		};
	};
};

export class ApiError extends Error {
	public readonly title: string;
	public readonly message: string;
	/** http code, -1 if miscellaneous network error */
	public readonly statusText: string;
	public readonly httpCode: number|undefined;

	constructor(title: string, message: string, statusText: string, httpCode: number|undefined) {
		super(message);
		this.title = title;
		this.message = message;
		this.statusText = statusText;
		this.httpCode = httpCode;
	}
}

// Import quirks, duplicate these

/** Generic object to represent an option in a dropdown multiple-choice, checkbox list, etc. */
export type Option = {
	value: string;
	label?: string;
	title?: string|null;
	disabled?: boolean;
};
/** Generic object to represent a group of Options in a dropdown multiple-choide, checkbox list, etc. */
export type OptGroup = {
	label?: string;
	title?: string|null;
	disabled?: boolean;
	options: Array<string|Option>;
};
