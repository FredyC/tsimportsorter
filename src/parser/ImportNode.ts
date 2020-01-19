import {
  ImportDeclaration,
  ImportEqualsDeclaration,
  SourceFile,
  StringLiteral,
  SyntaxKind,
} from 'typescript';

import {
  composeComments,
  ComposeConfig,
  composeName,
  composeNames,
} from '../compose';
import {
  assert,
  assertNonNull,
  normalizePath,
} from '../utils';
import { parseLineRanges } from './lines';
import {
  LineRange,
  NameBinding,
  NodeComment,
  Pos,
  RangeAndEmptyLines,
} from './types';

export default class ImportNode {
  private readonly node_: ImportDeclaration | ImportEqualsDeclaration;

  private moduleIdentifier_: string;
  private isScript_: boolean;
  private defaultName_?: NameBinding;
  private names_?: NameBinding[];

  private fullStart_: Pos;
  private leadingNewLines_: number;
  private leadingComments_?: NodeComment[];
  // private declLineRange_: LineRange;
  // private trailingComments_?: NodeComment[];
  private trailingCommentsText_: string;
  private declAndCommentsLineRange_: LineRange;
  private trailingNewLines_: number;
  private fullEnd_: Pos;
  private eof_: boolean;

  static fromDecl(node: ImportDeclaration, sourceFile: SourceFile, sourceText: string) {
    const { importClause, moduleSpecifier } = node;

    // moduleIdentifier
    assert(moduleSpecifier.kind === SyntaxKind.StringLiteral);
    const moduleIdentifier = (moduleSpecifier as StringLiteral).text;

    // import 'some/scripts'
    if (!importClause) return new ImportNode(node, sourceFile, sourceText, moduleIdentifier, true);

    // defaultName & names
    const { name, namedBindings } = importClause;
    const defaultName = name
      ? { propertyName: name.text }
      : namedBindings && namedBindings.kind === SyntaxKind.NamespaceImport
      ? { aliasName: namedBindings.name.text }
      : undefined;
    const names =
      namedBindings && namedBindings.kind === SyntaxKind.NamedImports
        ? namedBindings.elements.map(e => {
            const { name, propertyName } = e;
            return propertyName
              ? { aliasName: name.text, propertyName: propertyName.text }
              : { propertyName: name.text };
          })
        : undefined;

    return new ImportNode(
      node,
      sourceFile,
      sourceText,
      moduleIdentifier,
      false,
      defaultName,
      names,
    );
  }

  static fromEqDecl(node: ImportEqualsDeclaration, sourceFile: SourceFile, sourceText: string) {
    const { moduleReference } = node;
    assert(moduleReference.kind === SyntaxKind.ExternalModuleReference);
    const { expression } = moduleReference;
    assert(expression.kind === SyntaxKind.StringLiteral);
    const moduleIdentifier = (expression as StringLiteral).text;
    const defaultName = { propertyName: node.name.text };
    return new ImportNode(node, sourceFile, sourceText, moduleIdentifier, false, defaultName);
  }

  get rangeAndEmptyLines(): RangeAndEmptyLines {
    return {
      ...this.declAndCommentsLineRange_,
      fullStart: this.fullStart_,
      leadingNewLines: this.leadingNewLines_,
      trailingNewLines: this.trailingNewLines_,
      fullEnd: this.fullEnd_,
      eof: this.eof_,
    };
  }

  get isScriptImport() {
    return this.isScript_;
  }

  removeUnusedNames(allNames: Set<string>) {
    if (this.isScript_) return this;
    if (!isNameUsed(this.defaultName_, allNames)) this.defaultName_ = undefined;
    this.names_ = this.names_?.filter(n => isNameUsed(n, allNames));
    if (this.names_?.length === 0) this.names_ = undefined;
    return this.defaultName_ || this.names_ ? this : undefined;
  }

  match(regex: string) {
    return !!new RegExp(regex).exec(this.moduleIdentifier_);
  }

  compare(node: ImportNode) {
    return (
      idComparator(this.moduleIdentifier_, node.moduleIdentifier_) ||
      nameComparator(this.defaultName_, node.defaultName_)
    );
  }

  compose(config: ComposeConfig) {
    const leadingText = composeComments(this.leadingComments_) ?? '';
    const importText = this.composeImport(config);
    const trailingText = this.trailingCommentsText_;
    return leadingText + importText + trailingText;
  }

  /**
   * @returns true if `node` is fully merged to `this`; Or false if `node` still has names thus can't be ignored.
   */
  merge(node: ImportNode) {
    const { moduleIdentifier_, node_ } = node;
    if (
      this.moduleIdentifier_ !== moduleIdentifier_ ||
      this.node_.kind !== node_.kind ||
      (this.hasLeadingComments && node.hasLeadingComments) ||
      (this.hasTailingComments && node.hasTailingComments)
    )
      return false;
    // Take and merge binding names from node
    if (this.names_ && node.names_) this.names_ = this.names_.concat(node.names_);
    else if (!this.names_) this.names_ = node.names_;
    if (this.names_) {
      this.names_ = this.names_.sort(nameComparator).reduce((r, n) => {
        if (!r.length) return [n];
        const last = r[r.length - 1];
        return nameComparator(last, n) ? [...r, n] : r;
      }, [] as NameBinding[]);
    }
    node.names_ = undefined;
    // Try to merge default name from node
    if (!this.defaultName_) {
      this.defaultName_ = node.defaultName_;
    } else if (node.defaultName_ && nameComparator(this.defaultName_, node.defaultName_))
      return false;
    node.defaultName_ = undefined;
    // Take comments if any
    if (!this.leadingComments_) this.leadingComments_ = node.leadingComments_;
    if (!this.trailingCommentsText_) this.trailingCommentsText_ = node.trailingCommentsText_;
    node.leadingComments_ = undefined;
    node.trailingCommentsText_ = '';

    return true;
  }

  private constructor(
    node: ImportDeclaration | ImportEqualsDeclaration,
    sourceFile: SourceFile,
    sourceText: string,
    moduleIdentifier: string,
    isScript: boolean,
    defaultName?: NameBinding,
    names?: NameBinding[],
  ) {
    this.node_ = node;
    this.moduleIdentifier_ = normalizePath(moduleIdentifier);
    this.isScript_ = isScript;
    this.defaultName_ = defaultName;
    this.names_ = names;
    const {
      fullStart,
      leadingNewLines,
      leadingComments,
      // declLineRange,
      // trailingComments,
      trailingCommentsText,
      declAndCommentsLineRange,
      trailingNewLines,
      fullEnd,
      eof,
    } = parseLineRanges(node, sourceFile, sourceText);
    this.fullStart_ = fullStart;
    this.leadingNewLines_ = leadingNewLines;
    this.leadingComments_ = leadingComments;
    // this.declLineRange_ = declLineRange;
    // this.trailingComments_ = trailingComments;
    this.trailingCommentsText_ = trailingCommentsText;
    this.declAndCommentsLineRange_ = declAndCommentsLineRange;
    this.trailingNewLines_ = trailingNewLines;
    this.fullEnd_ = fullEnd;
    this.eof_ = eof;
  }

  private get hasLeadingComments() {
    return !!this.leadingComments_ && this.leadingComments_.length > 0;
  }

  private get hasTailingComments() {
    return !!this.trailingCommentsText_;
  }

  private composeImport(config: ComposeConfig) {
    switch (this.node_.kind) {
      case SyntaxKind.ImportDeclaration:
        return this.composeDecl(config);
      case SyntaxKind.ImportEqualsDeclaration:
        return this.composeEqDecl(config);
    }
  }

  // import A = require('B');
  composeEqDecl(config: ComposeConfig) {
    const { quote, semi } = config;
    const path = this.moduleIdentifier_;
    const name = this.defaultName_?.propertyName;
    assertNonNull(name);
    return `import ${name} = require(${quote(path)})${semi}`;
  }

  /**
   * Default name examples:
   * ```
   *    import A from 'B';
   *    import * as A from 'B';
   * ```
   *
   * Binding names examples:
   * ```
   *    import { A, B as C } from 'D';
   *    import {
   *      A, B,
   *      C as D,
   *    } from 'E';
   * ```
   *
   * Mixed examples:
   * ```
   *    import A, { B, C } from 'D';
   *    import * as A, {
   *      B,
   *      C as D,
   *      E,
   *    } from 'F';
   * ```
   */
  composeDecl(config: ComposeConfig) {
    const { maxLength } = config;
    const { text, type } = this.composeDeclImpl(config, false);
    if (maxLength >= text.length || type !== 'line') return text;
    return this.composeDeclImpl(config, true).text;
  }

  composeDeclImpl(config: ComposeConfig, forceWrap: boolean) {
    const { quote, semi } = config;
    const path = this.moduleIdentifier_;
    const ending = quote(path) + semi;
    if (this.isScript_) return { text: `import ${ending}` };
    const { text, type } = composeNames(this.names_, config, forceWrap);
    const names = [composeName(this.defaultName_), text].filter(s => !!s).join(', ');
    return { text: `import ${names} from ${ending}`, type };
  }
}

export function isNameUsed(nameBinding: NameBinding | undefined, allNames: Set<string>) {
  const name = nameBinding?.aliasName ?? nameBinding?.propertyName;
  return !!name && allNames.has(name);
}

function idComparator(aa: string | undefined, bb: string | undefined) {
  if (aa === undefined) return bb === undefined ? 0 : -1;
  else if (bb === undefined) return 1;
  const a = aa.toLowerCase();
  const b = bb.toLowerCase();
  return a < b ? -1 : a > b ? 1 : aa < bb ? -1 : aa > bb ? 1 : 0;
}

function nameComparator(a: NameBinding | undefined, b: NameBinding | undefined) {
  if (!a) return b ? -1 : 0;
  else if (!b) return 1;
  const { propertyName: pa, aliasName: aa } = a;
  const { propertyName: pb, aliasName: ab } = b;
  return idComparator(pa, pb) || idComparator(aa, ab);
}