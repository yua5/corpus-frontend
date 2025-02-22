<template>
	<div class="btn-group">
		<button
			type="button"
			class="btn btn-default btn-sm"
			:disabled="downloadInProgress || disabled"
			:title="(downloadInProgress ? $t('results.export.downloading') : $t('results.export.csvTooltip')).toLocaleString()"

			@click="downloadCsv(false)"
		>
			<template v-if="downloadInProgress">&nbsp;<span class="fa fa-spinner fa-spin"></span>&nbsp;</template>
			{{ $t('results.export.exportCSV') }}
		</button>
		<button
			type="button"
			class="btn btn-default btn-sm"
			:disabled="downloadInProgress || disabled"
			:title="(downloadInProgress ? $t('results.export.downloading') : $t('results.export.excelTooltip')).toLocaleString()"

			@click="downloadCsv(true)"
		>
			<template v-if="downloadInProgress">&nbsp;<span class="fa fa-spinner fa-spin"></span>&nbsp;</template>
			{{ $t('results.export.exportExcel') }}
		</button>
		<!-- <button type="button"  class="btn btn-default btn-sm dropdown-toggle" data-toggle="dropdown" aria-expanded="false">
			<span class="caret"></span>
		</button> -->
		<!-- <ul class="dropdown-menu dropdown-menu-right" @click.stop>
			<li><a class="checkbox" title="Adds a header describing the query used to generate these results.">
				<label><input type="checkbox" v-model="exportSummary">Include summary</label></a>
			</li>
			<li><a class="checkbox"
				title="Adds a header line declaring that the file is comma-separated,
				for some versions of microsoft excel this is required to correctly display the file."
			><label><input type="checkbox" v-model="exportSeparator">Export for excel</label></a></li>
			<li v-if="isHits"><a class="checkbox"
				title="Also export document metadata. Warning: this might result in very large exports!"
			><label><input type="checkbox" v-model="exportHitMetadata">Export metadata</label></a></li>
		</ul> -->
	</div>
</template>

<script lang="ts">
import Vue from 'vue';
import cloneDeep from 'clone-deep';
import {saveAs} from 'file-saver';

import * as Api from '@/api';

import { BLSearchResult } from '@/types/blacklabtypes';
import * as UIStore from '@/store/search/ui';
import * as CorpusStore from '@/store/search/corpus';
import { debugLog } from '@/utils/debug';
import { ensureCompleteFieldName, getParallelFieldName, getParallelFieldParts, isParallelField } from '@/utils';

export default Vue.extend({
	props: {
		results: Object as () => BLSearchResult,
		type: String as () => 'hits'|'docs',
		annotations: Array as () => string[],
		metadata: Array as () => string[],

		disabled: Boolean
	},
	data: () => ({
		downloadInProgress: false,
	}),
	methods: {
		downloadCsv(excel: boolean) {
			if (this.downloadInProgress || !this.results) {
				return;
			}

			this.downloadInProgress = true;
			const apiCall = this.type === 'hits' ? Api.blacklab.getHitsCsv : Api.blacklab.getDocsCsv;
			const params = cloneDeep(this.results.summary.searchParam);
			if (this.annotations) params.listvalues = this.annotations!.join(',');
			if (this.metadata) params.listmetadatavalues = this.metadata.join(',');
			(params as any).csvsepline = !!excel;
			(params as any).csvsummary = true;
			const fieldDisplayName = (name: string, baseFieldName: string = '') => {
				const defaultField = this.results.summary.pattern?.fieldName ?? CorpusStore.get.mainAnnotatedField();
				name = ensureCompleteFieldName(name, defaultField); // don't just pass version name
				return this.$td(`index.annotatedFields.${name}`, name);
			}
			(params as any).csvdescription = UIStore.corpusCustomizations.results.csvDescription(this.results.summary, fieldDisplayName) || '';

			debugLog('starting csv download', this.type, params);
			apiCall(INDEX_ID, params).request
			.then(
				blob => saveAs(blob, 'data.csv'),
				error => debugLog('Error downloading csv file', error)
			)
			.finally(() => this.downloadInProgress = false);
		},
	}
})
</script>