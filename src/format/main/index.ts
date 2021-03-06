import ts, {
  CompilerOptions,
  ScriptTarget,
} from 'typescript';

import {
  ComposeConfig,
  configForCompose,
  Configuration,
} from '../config';
import {
  apply,
  EditManager,
} from '../edit';
import {
  ExportNode,
  getUnusedIds,
  ImportNode,
  NameUsage,
  parseSource,
} from '../parser';
import {
  Sorter,
  sorterFromRules,
  sortExports,
  sortImports,
} from '../sort';
import { RangeAndEmptyLines } from '../types';
import { logger } from '../utils';

export function formatSource(
  fileName: string,
  sourceText: string,
  config: Configuration,
  tsCompilerOptions?: CompilerOptions,
) {
  const log = logger('parser.formatSource');
  log.debug('config:', config);
  log.debug('tsCompilerOptions:', tsCompilerOptions);
  const sourceFile = ts.createSourceFile(fileName, sourceText, ScriptTarget.Latest);
  const { importNodes, importsInsertPoint: point, exportNodes, allIds } = parseSource(
    sourceFile,
    sourceText,
    config,
    tsCompilerOptions,
  );
  const editManager = new EditManager([...importNodes, ...exportNodes]);
  if (editManager.empty()) {
    log.info('No sortable imports or exports found. Skipping file.');
    return undefined;
  }
  const composeConfig = configForCompose(config);
  log.info('composeConfig:', composeConfig);
  const unusedIds = () =>
    getUnusedIds(allIds, importNodes, fileName, sourceFile, tsCompilerOptions);
  const sorter = sorterFromRules(config.sortRules);
  const text = formatImports(importNodes, point, unusedIds, config, composeConfig, sorter);
  if (text && point) editManager.insert({ range: point, text, trailingNewLines: 2 });
  const edits = formatExports(exportNodes, composeConfig, sorter);
  edits.forEach(e => editManager.insert(e));

  return apply(sourceText, sourceFile, editManager.generateEdits(composeConfig));
}

function formatImports(
  importNodes: ImportNode[],
  insertPoint: RangeAndEmptyLines | undefined,
  unusedIds: () => NameUsage,
  config: Configuration,
  composeConfig: ComposeConfig,
  sorter: Sorter,
) {
  if (!insertPoint || !importNodes.length) return undefined;
  const groups = sortImports(importNodes, unusedIds(), config, sorter);
  const { nl } = composeConfig;
  return groups.compose(composeConfig, nl + nl);
}

function formatExports(exportNodes: ExportNode[], composeConfig: ComposeConfig, sorter: Sorter) {
  if (!exportNodes.length) return [];
  sortExports(exportNodes, sorter.compareNames);
  return exportNodes
    .filter(n => !n.empty())
    .map(n => {
      const { range } = n;
      const { leadingNewLines: ln, trailingNewLines: tn } = range;
      const leadingNewLines = Math.min(ln, 2);
      const trailingNewLines = Math.min(tn, 2);
      return { range, text: n.compose(composeConfig), leadingNewLines, trailingNewLines };
    });
}
