// gedoe ... de patternStore (src/store/search/form/patterns.ts) is een goed voorbeeldje want redelijk simpel
// Zie https://github.com/mrcrowl/vuex-typex/blob/master/src/index.ts voor de gebruikte ts implementatie

import cloneDeep from 'clone-deep';

import { getStoreBuilder } from 'vuex-typex';
import { BLHit } from '@/types/blacklabtypes';
import { RootState } from '@/store/search/';
import * as PatternStore from '@/store/search/form/patterns';

import {glossApi, init as initGlossEndpoint} from '@/api';
import Vue from 'vue';





declare const INDEX_ID: string;
// See header.vm
declare const USERNAME: string;
declare const PASSWORD: string;

type GlossFieldType = {
	 type: string,
	 values: string[]
}

type GlossFieldDescription = {
	type: GlossFieldType,
	fieldName: string
}

const BooleanField: GlossFieldType = { //{"type":"boolean","values":["","true","false"]}
	type: 'boolean',
	values: ['', 'true', 'false']
}

const JobField: GlossFieldType = { // {"type":"boolean","values":["","logic and linguistics","meanings of the preposition in","god in logic","adjective collocations of truth"]}
	type: 'boolean',
	values: ['', 'logic and linguistics', 'meanings of the preposition in', 'god in logic', 'adjective collocations of truth']
}

const StringField: GlossFieldType = { // {"type":"string","values":[]}
	type: 'string',
	values: []
}

type Gloss = {
	[key: string]: string;
}

type GlossQuery = {
	author: string,
	corpus: string,
	parts: { [key: string]: string; }
}

type Glossing = {
	gloss: Gloss,
	author: string,
	corpus: string,
	hitId: string,
	hit_first_word_id: string,
	hit_last_word_id: string
}

type Hit2String = (a: BLHit) => string;
type Hit2Range = (a: BLHit) => {startid: string, endid: string};
type Settings = {
	gloss_fields: GlossFieldDescription[],
	/** Any trailing '/' will be stripped. */
	blackparank_server: string,
	blackparank_instance: string,
	get_hit_id: Hit2String,
	get_hit_range_id: Hit2Range,
}

type ModuleRootState = {
	glosses: Record<string, Glossing>,
	gloss_query: GlossQuery,
	gloss_query_cql: string,
	current_page: string[], // ids of hits currently visible in result display
	settings: Settings,
};

/** Must be initialized from customjs */
const initialState: ModuleRootState = {
	glosses: {},
	current_page: [],
	gloss_query: {
		author: USERNAME,
		corpus: INDEX_ID,
		parts: {comment : ''}
	},
	gloss_query_cql: '',
	settings: {
		blackparank_server: '',
		blackparank_instance: 'quine',

		gloss_fields: [{fieldName: 'job', type: JobField}, {fieldName: 'relevant', type: BooleanField}, {fieldName: 'comment', type: StringField}],
		get_hit_id: h => h.docPid + '_' + h.start + '_' + h.end,
		get_hit_range_id: h => {
			const idz = h.match['_xmlid']
			const r = { startid: idz[0], endid: idz[idz.length-1] }
			// alert(JSON.stringify(r))
			return r
		} // dit is niet super persistent voor corpusversies....
	},
}


const namespace = 'glosses';
const b = getStoreBuilder<RootState>().module<ModuleRootState>(namespace, cloneDeep(initialState));

const getState = b.state();
// intentionally empty, it's just there to prevent this module from being removed by tree-shake (i.e. left out during build)
const init = () => {};


/////////////////////////////////////////////////////////////////////////////////////////////
// getters and actions
/////////////////////////////////////////////////////////////////////////////////////////////

// TODO parameters in getters is not supported.
// The functions won't be reactive. (i.e. component won't re-evaluate automatically when the getter would return a different value)
const get = {
	getGloss: (h: BLHit): Glossing|null =>  {
		const state = getState()
		const hit_id = state.settings.get_hit_id(h)
		return state.glosses[hit_id] // kan null zijn
	},
	getGlossById(hitId: string) {
		return getState().glosses[hitId]
	},
	getGlossValue(hitId: string, fieldName: string)  {
		const glosses = getState().glosses
		if (hitId in glosses) {
			const glossing: Glossing = glosses[hitId]
			const fieldValue =  glossing.gloss[fieldName];
			console.log(`Gloss GET ${hitId} ${fieldName}=${fieldValue}`)
			return fieldValue
		}
		else return ''
	},
	getGlossQueryFieldValue(fieldName: string) { return getState().gloss_query.parts[fieldName]; },
	glossQuery: b.read(s => s.gloss_query, 'gloss_query'),
	settings: b.read(s => s.settings, 'settings'),
	gloss_fields: b.read(s => s.settings.gloss_fields, 'gloss_fields'),
	get_hit_id_function: b.read(s => s.settings.get_hit_id, 'get_hit_id_function'),
};

const actions = {
	reset: b.commit((state) => {
		state.glosses = {}
	}, 'flush_all_glosses'),

	addGloss: b.commit((state, payload: {gloss: Gloss, hit: BLHit}) =>  {
		// store locally
		const range = state.settings.get_hit_range_id(payload.hit)
		const hitId = state.settings.get_hit_id(payload.hit)
		const glossing: Glossing = {
			gloss: payload.gloss,
			author: USERNAME,
			corpus: INDEX_ID,
			hitId,
			hit_first_word_id: range.startid,
			hit_last_word_id: range.endid
		}
		Vue.set(state.glosses, hitId, glossing);
	}, 'add_gloss'),

	addGlossing: b.commit((state, payload: Glossing) => {
		const hitId = payload.hitId
		Vue.set(state.glosses, hitId, payload);
	}, 'add_glossing'),

	setOneGlossField: b.commit((state, payload: { hitId: string, fieldName: string, fieldValue: string, hit_first_word_id: string, hit_last_word_id: string}) => {
		const {hitId, fieldName, fieldValue, hit_first_word_id, hit_last_word_id} = payload;
		console.log(`Gloss SET ${hitId} ${fieldName}=${fieldValue}`)
		const glossing = {
			gloss: {
				...state.glosses[hitId]?.gloss,
				[fieldName]: fieldValue
			},
			author: USERNAME,
			corpus: INDEX_ID,
			hitId,
			hit_first_word_id,
			hit_last_word_id,
		}
		Vue.set(state.glosses, hitId, glossing);
		actions.storeToDatabase({glossings: [glossing]})
	}, `set_gloss_field_value`), // als je dit twee keer doet gaat ie mis wegens dubbele dinges...

	setQueryCql: b.commit((state, payload: string) => {state.gloss_query_cql = payload}, 'set_cql'),
	updateCQL: b.commit((state) =>  {
		const p = state.gloss_query.parts
		const validKeys = Object.keys(state.gloss_query.parts).filter(k => p[k]?.length);
		if (validKeys.length === 0) {
			state.gloss_query_cql = ''
			return
		};
		const q = validKeys.reduce<Record<string, string>>((acc, k) => { acc[k] = p[k]; return acc; }, {});
		glossApi.getCql(state.settings.blackparank_instance, USERNAME, INDEX_ID, JSON.stringify(q))
			.then(cql => {
				actions.setQueryCql(cql);
				PatternStore.actions.glosses(state.gloss_query_cql);
			})
			.catch(e => {
				console.error(e);
				alert(e.message);
			});
	}, 'gloss_search_update_cql'),
	setOneGlossQueryField: b.commit((state, payload: {  fieldName: string, fieldValue: string })  => {
		const fieldName = payload.fieldName
		const fieldValue = payload.fieldValue
		Vue.set(state.gloss_query.parts, fieldName, fieldValue);
		// and translate query to cql......?
		//alert('Set gloss query field: ' + JSON.stringify(payload))
		actions.updateCQL()
	}, `set_gloss_queryfield_value`), // als je dit twee keer doet gaat ie mis wegens dubbele dinges...
	resetGlossQuery: b.commit((state)  => {
		state.gloss_query.parts = {}
		actions.updateCQL()
	}, `reset_gloss_query`), // als je dit twee keer doet gaat ie mis wegens dubbele dinges...

	storeToDatabase: b.commit((state, payload: {glossings: Glossing[]}) => glossApi
		.storeGlosses(state.settings.blackparank_instance, payload.glossings)
		.catch(e => {
			console.error(e);
			alert(e.message);
		})
	, 'store_to_database'),
	setCurrentPage: b.commit((state, payload: string[]) => {
		state.current_page = payload
		glossApi
			.getGlosses(state.settings.blackparank_instance, INDEX_ID, USERNAME, payload)
			.then(glossings => glossings.forEach(actions.addGlossing))
			.catch(e => {
				console.error(e);
				alert(e.message);
			});
	}, 'set_current_page'),
	loadSettings: b.commit((state, payload: Settings) => {
		state.settings = payload
		state.settings.blackparank_server = state.settings.blackparank_server.replace(/\/$/, '');
		initGlossEndpoint('gloss', state.settings.blackparank_server);
	} , 'gloss_load_settings'),
};

// hebben we de init nodig?
export {
	ModuleRootState,
	namespace,
	actions,
	getState,
	get,
	init,
	Gloss,
	Glossing,
	Settings,
	GlossFieldType,
	GlossFieldDescription
}


