import { memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { detectSourceLanguage } from '@zeus/shared';
import type { TaskGitFileDiff } from '../session/sessionTypes.js';
import { monaco, initializeSourceEditor, editorLanguage, exposeEditorControl, createTransientSourceModel } from './monacoRuntime.js';
import { loadEditorGrammar } from './monacoGrammars.js';
import { formatBlameAuthor, hasBlameCommit } from './blamePresentation.js';
import { CodeEditor } from './CodeEditor.js';
import { CodeReviewTextContext } from './codeReviewContext.js';
import { FilePreviewDataContext } from './FilePreview.js';
import { fullFileDiff, refreshedFileDiff } from './fullFileDiff.js';
import { previewText } from './useFilePreviewDraft.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import './codeDiffView.css';

export interface DiffAnnotationLine {
  line: number;
  side: 'left' | 'right';
}
interface DiffRow {
  left: string;
  right: string;
  leftNumber: number | null;
  rightNumber: number | null;
  kind: string;
}
export interface CodeDiffViewProps {
  file: TaskGitFileDiff;
  unified?: boolean;
  singleSide?: 'left' | 'right';
  alignReplacements?: boolean;
  resizable?: boolean;
  omitHunkHeaders?: boolean;
  label: string;
  blame?: { left: import('@zeus/shared').FilePreviewBlameLine[]; right: import('@zeus/shared').FilePreviewBlameLine[] };
  blameLocale?: string;
  revealLine?: DiffAnnotationLine;
  revertDisabled?: boolean;
  annotationLines?: DiffAnnotationLine[];
  focusAnnotation?: DiffAnnotationLine;
  renderLineNumber?: (line: number, side: 'left' | 'right') => ReactNode;
  renderLineComments?: (line: number, side: 'left' | 'right') => ReactNode;
}

/** 普通审阅采用原生 Diff；含评论的补丁保留权威行号映射，共用 Monaco 模型和高亮。 */
export const CodeDiffView = memo(function CodeDiffView(props: CodeDiffViewProps) {
  const preview = useContext(FilePreviewDataContext);
  const unified = preview?.unified ?? props.unified;
  return props.singleSide || props.renderLineNumber || props.renderLineComments ? <AnnotatedDiff {...props} unified={unified} /> : <NativeDiff {...props} unified={unified} />;
});

function NativeDiff(props: CodeDiffViewProps) {
  const fullText = useContext(CodeReviewTextContext);
  const preview = useContext(FilePreviewDataContext);
  const complete = preview?.items?.length === 2 && preview.items.every((item) => item.missing || (item.kind === 'text' && !item.truncated));
  const editing = complete ? preview?.editing : undefined;
  const editable = Boolean(editing?.writable);
  const latest = useRef({ editing });
  latest.current = { editing };
  const host = useRef<HTMLDivElement>(null);
  const applying = useRef(false);
  const [view, setView] = useState<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [localFull, setFull] = useState(false);
  const full = preview?.full ?? localFull;
  const rows = useMemo(() => diffRows(props.file, false, Boolean(props.omitHunkHeaders)), [props.file, props.omitHunkHeaders]);
  const documents = useMemo(() => {
    if (complete) return { left: previewText(preview!.items![0]), right: editing?.content ?? previewText(preview!.items![1]), leftNumbers: null, rightNumbers: null };
    if (fullText && !props.omitHunkHeaders) return { left: fullText.original, right: fullText.modified, leftNumbers: null, rightNumbers: null };
    const left = rows.filter((row) => row.leftNumber !== null || row.kind === 'header');
    const right = rows.filter((row) => row.rightNumber !== null || row.kind === 'header');
    return { left: left.map((row) => row.left).join('\n'), right: right.map((row) => row.right).join('\n'), leftNumbers: left.map((row) => row.leftNumber), rightNumbers: right.map((row) => row.rightNumber) };
  }, [rows, fullText, props.omitHunkHeaders, complete, preview?.items, editing?.content]);
  const latestDocuments = useRef(documents);
  latestDocuments.current = documents;
  const hasFullText = complete || Boolean(fullText && !props.omitHunkHeaders);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setError('');
    void initializeSourceEditor()
      .then(async () => {
        const language = editorLanguage(props.file.newPath || props.file.oldPath, detectSourceLanguage(props.file.newPath || props.file.oldPath));
        await loadEditorGrammar(language);
        if (disposed || !host.current) return;
        const original = await createTransientSourceModel(latestDocuments.current.left, language);
        const modified = await createTransientSourceModel(latestDocuments.current.right, language).catch((cause: unknown) => {
          original.dispose();
          throw cause;
        });
        if (disposed || !host.current) {
          original.dispose();
          modified.dispose();
          return;
        }
        const editor = monaco.editor.createDiffEditor(host.current, {
          automaticLayout: true,
          readOnly: !editable,
          originalEditable: false,
          renderSideBySide: !props.unified,
          enableSplitViewResizing: props.resizable ?? true,
          diffAlgorithm: 'advanced',
          ignoreTrimWhitespace: false,
          renderIndicators: true,
          renderOverviewRuler: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          ariaLabel: props.label,
          hideUnchangedRegions: { enabled: hasFullText && !full, contextLineCount: 4, minimumLineCount: 8, revealLineCount: 20 },
          renderSideBySideInlineBreakpoint: 0,
          renderGutterMenu: editable,
        });
        editor.setModel({ original: original.model, modified: modified.model });
        const changed = modified.model.onDidChangeContent(() => {
          if (!applying.current) latest.current.editing?.onChange(modified.model.getValue());
        });
        editor.getModifiedEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          void latest.current.editing?.onSave();
        });
        setView(editor);
        cleanup = () => {
          changed.dispose();
          editor.dispose();
          original.dispose();
          modified.dispose();
        };
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [props.file.newPath, props.file.oldPath, editable]);
  useEffect(() => {
    const model = view?.getModel();
    if (!model) return;
    applying.current = true;
    try {
      if (model.original.getValue() !== documents.left) model.original.setValue(documents.left);
      if (model.modified.getValue() !== documents.right) model.modified.setValue(documents.right);
      view!.getOriginalEditor().updateOptions({ lineNumbers: documents.leftNumbers ? (number) => String(documents.leftNumbers?.[number - 1] ?? '') : 'on' });
      view!.getModifiedEditor().updateOptions({ lineNumbers: documents.rightNumbers ? (number) => String(documents.rightNumbers?.[number - 1] ?? '') : 'on' });
    } finally {
      applying.current = false;
    }
  }, [view, documents]);
  useEffect(() => {
    view?.updateOptions({
      renderSideBySide: !props.unified,
      enableSplitViewResizing: props.resizable ?? true,
      ariaLabel: props.label,
      readOnly: !editable || Boolean(editing?.saving || editing?.conflict),
      hideUnchangedRegions: { enabled: hasFullText && !full },
      renderGutterMenu: editable && !props.revertDisabled && !editing?.saving,
    });
  }, [view, props.unified, props.resizable, props.label, editable, editing?.saving, editing?.conflict, full, hasFullText, props.revertDisabled]);
  useEffect(() => {
    if (!view || !props.revealLine) return;
    const side = props.revealLine.side;
    const numbers = side === 'left' ? documents.leftNumbers : documents.rightNumbers;
    const line = numbers ? numbers.indexOf(props.revealLine.line) + 1 : props.revealLine.line;
    if (line > 0) (side === 'left' ? view.getOriginalEditor() : view.getModifiedEditor()).revealLineInCenter(line);
  }, [view, props.revealLine, documents]);
  useEffect(() => {
    if (!view || !props.blame) return;
    const cleanups = (['left', 'right'] as const).map((side) => {
      const editor = side === 'left' ? view.getOriginalEditor() : view.getModifiedEditor();
      const numbers = side === 'left' ? documents.leftNumbers : documents.rightNumbers;
      const source = side === 'left' ? documents.left : documents.right;
      const marks = editor.createDecorationsCollection();
      const update = () => {
        const model = editor.getModel(),
          position = editor.getPosition();
        const number = position ? (numbers ? numbers[position.lineNumber - 1] : position.lineNumber) : null;
        const line = props.blame?.[side].find((entry) => entry.line === number);
        // 草稿行号不再代表已授权的 Git 版本，保存后取得新快照才恢复归属。
        if (!model || !position || !hasBlameCommit(line) || !editor.hasTextFocus() || !editor.getSelection()?.isEmpty() || model.getValue() !== source || (side === 'right' && editing?.dirty)) {
          marks.clear();
          return;
        }
        const column = model.getLineMaxColumn(position.lineNumber);
        marks.set([
          {
            range: new monaco.Range(position.lineNumber, column, position.lineNumber, column),
            options: {
              after: { content: '  ' + formatBlameAuthor(line) + ' · ' + (line.subject || line.shortHash), inlineClassName: 'source-blame-inline', cursorStops: monaco.editor.InjectedTextCursorStops.None },
              hoverMessage: { value: line.shortHash + ' · ' + line.author + '\n\n' + line.subject, isTrusted: false },
            },
          },
        ]);
      };
      const subscriptions = [editor.onDidChangeCursorSelection(update), editor.onDidFocusEditorText(update), editor.onDidBlurEditorText(update), editor.onDidChangeModelContent(() => marks.clear())];
      update();
      return () => {
        subscriptions.forEach((item) => item.dispose());
        marks.clear();
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [view, props.blame, documents, editing?.dirty]);
  const zh = preview?.zh !== false;
  return (
    <div className="zeus-monaco-diff" aria-label={props.label}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div className="zeus-diff-navigation" role="group" aria-label={zh ? '差异操作' : 'Diff actions'}>
        {hasFullText && !preview ? (
          <button type="button" aria-pressed={full} onClick={() => setFull(!full)}>
            {full ? (zh ? '差异附近' : 'Changes') : zh ? '全文' : 'Full file'}
          </button>
        ) : null}
        <button type="button" onClick={() => view?.goToDiff('previous')} aria-label={zh ? '上一个差异' : 'Previous change'}>
          ↑
        </button>
        <button type="button" onClick={() => view?.goToDiff('next')} aria-label={zh ? '下一个差异' : 'Next change'}>
          ↓
        </button>
        {editable ? (
          <>
            <button type="button" disabled={!editing?.dirty || editing.saving || editing.conflict} onClick={() => void editing?.onSave()}>
              {editing?.saving ? (zh ? '保存中…' : 'Saving…') : zh ? '保存' : 'Save'}
            </button>
            <button type="button" disabled={!editing?.dirty || editing.saving} onClick={() => setDiscard(true)}>
              {zh ? '放弃草稿' : 'Discard draft'}
            </button>
            {editing?.conflict ? <span role="alert">{zh ? '文件已在外部修改，请核对后放弃草稿或保留内容。' : 'The file changed externally. Review before discarding your draft.'}</span> : null}
            {editing?.error ? <VisibleApplicationError error={editing.error} language={zh ? 'zh-CN' : 'en'} /> : null}
          </>
        ) : null}
      </div>
      {discard ? (
        <ModalPortal role="alertdialog" aria-label={zh ? '放弃未保存改动' : 'Discard unsaved changes'} onDismiss={() => setDiscard(false)}>
          <section className="code-diff-revert-dialog" data-modal-surface="dialog">
            <p>{zh ? '放弃当前草稿？磁盘文件不会改变。' : 'Discard this draft? The file on disk will remain unchanged.'}</p>
            <button type="button" onClick={() => setDiscard(false)}>
              {zh ? '取消' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => {
                editing?.onDiscard();
                setDiscard(false);
              }}
            >
              {zh ? '放弃草稿' : 'Discard draft'}
            </button>
          </section>
        </ModalPortal>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

interface LinePortal {
  key: string;
  element: HTMLElement;
  row: number;
  side: 'left' | 'right';
}
interface CommentPortal extends LinePortal {
  body: HTMLElement;
}

/** 评论使用 ViewZone；不会把空白和评论写进源码，也不会随滚动丢失草稿。 */
function AnnotatedDiff(props: CodeDiffViewProps) {
  const preview = useContext(FilePreviewDataContext);
  const file = useMemo(() => {
    const updated = refreshedFileDiff(props.file, preview?.items ?? null, preview?.reverted);
    return preview?.full && preview.items ? (fullFileDiff(updated, preview.items) ?? updated) : updated;
  }, [props.file, preview?.items, preview?.full, preview?.reverted]);
  const rows = useMemo(() => diffRows(file, Boolean(props.alignReplacements && !props.unified), Boolean(props.omitHunkHeaders)), [file, props.alignReplacements, props.unified, props.omitHunkHeaders]);
  const content = useMemo(
    () => ({
      left: rows.map((row) => (props.unified ? (row.kind === 'addition' ? '+' : row.kind === 'deletion' ? '-' : ' ') + (row.kind === 'deletion' ? row.left : row.right) : row.left)).join('\n'),
      right: rows.map((row) => row.right).join('\n'),
    }),
    [rows, props.unified],
  );
  const [left, setLeft] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [right, setRight] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [linePortals, setLinePortals] = useState<LinePortal[]>([]);
  const commentNodes = useRef(new Map<string, CommentPortal>());
  const comments = useMemo(() => {
    const result: CommentPortal[] = [];
    for (const position of props.annotationLines ?? []) {
      const row = rows.findIndex((item) => item[position.side === 'left' ? 'leftNumber' : 'rightNumber'] === position.line);
      if (row < 0 || result.some((item) => item.row === row && item.side === position.side)) continue;
      const key = props.file.oldPath + ':' + props.file.newPath + ':' + position.side + ':' + position.line;
      let portal = commentNodes.current.get(key);
      if (!portal) {
        const element = document.createElement('div'),
          body = document.createElement('div');
        element.className = 'code-diff-annotation';
        element.append(body);
        portal = { key, element, body, side: position.side, row };
        commentNodes.current.set(key, portal);
      }
      result.push({ ...portal, row });
    }
    const retained = new Set(result.map((portal) => portal.key));
    for (const key of commentNodes.current.keys()) if (!retained.has(key)) commentNodes.current.delete(key);
    return result;
  }, [props.annotationLines, rows, props.file.oldPath, props.file.newPath]);
  useEffect(() => {
    if (props.singleSide === 'right' ? !right : !left || (!props.unified && !props.singleSide && !right)) return;
    const views = props.singleSide === 'right' ? [right!] : props.unified || props.singleSide === 'left' ? [left!] : [left!, right!];
    let syncing = false,
      frame = 0,
      active = true;
    const disposables: monaco.IDisposable[] = [];
    const widgets: Array<{ view: monaco.editor.IStandaloneCodeEditor; widget: monaco.editor.IGlyphMarginWidget }> = [];
    function renderMargins() {
      frame = 0;
      if (!active) return;
      widgets.splice(0).forEach(({ view, widget }) => view.removeGlyphMarginWidget(widget));
      const portals: LinePortal[] = [];
      views.forEach((view, index) => {
        const side: 'left' | 'right' = props.singleSide === 'right' ? 'right' : index === 0 ? 'left' : 'right';
        for (const visible of view.getVisibleRanges())
          for (let number = visible.startLineNumber; number <= visible.endLineNumber; number++) {
            const row = rows[number - 1];
            if (!row) continue;
            const sides: readonly ('left' | 'right')[] = props.unified ? ['left', 'right'] : [side];
            const element = document.createElement('div');
            element.className = 'zeus-diff-margin';
            for (const current of sides) {
              if (row[current === 'left' ? 'leftNumber' : 'rightNumber'] === null) continue;
              const part = document.createElement('span');
              element.append(part);
              portals.push({ key: side + ':' + current + ':' + number, element: part, row: number - 1, side: current });
            }
            const widget: monaco.editor.IGlyphMarginWidget = {
              getId: () => 'zeus-line-' + number,
              getDomNode: () => element,
              getPosition: () => ({ lane: monaco.editor.GlyphMarginLane.Left, zIndex: 10, range: new monaco.Range(number, 1, number, 1) }),
            };
            view.addGlyphMarginWidget(widget);
            exposeEditorControl(view, element);
            widgets.push({ view, widget });
          }
      });
      setLinePortals(portals);
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(renderMargins);
    };
    views.forEach((view, index) => {
      view.updateOptions({ glyphMargin: true, lineNumbers: 'off', lineDecorationsWidth: props.unified ? 100 : 54, wordWrap: 'off', padding: { top: 0, bottom: 32 } });
      const marks = view.createDecorationsCollection(
        rows.map((row, offset) => {
          const kind =
            props.unified || row.kind === 'header'
              ? row.kind
              : row[props.singleSide === 'right' ? 'rightNumber' : index === 0 ? 'leftNumber' : 'rightNumber'] === null
                ? 'empty'
                : row.kind === 'replacement'
                  ? props.singleSide === 'right'
                    ? 'addition'
                    : index === 0
                      ? 'deletion'
                      : 'addition'
                  : row.kind;
          return { range: new monaco.Range(offset + 1, 1, offset + 1, 1), options: { isWholeLine: true, className: 'code-diff-line is-' + kind } };
        }),
      );
      const container = view.getDomNode();
      const copy = (event: ClipboardEvent) => {
        if (props.unified || !view.hasTextFocus() || !event.clipboardData) return;
        const selections = view.getSelections()?.filter((selection) => !selection.isEmpty());
        const model = view.getModel();
        if (!model || !selections?.length) return;
        // 复制时去掉对齐空行与区块标题，保留原文中的空行和首尾选择范围。
        const text = selections
          .map((selection) => {
            const parts: string[] = [];
            for (let line = selection.startLineNumber; line <= selection.endLineNumber; line++) {
              if (rows[line - 1]?.[props.singleSide === 'right' ? 'rightNumber' : index === 0 ? 'leftNumber' : 'rightNumber'] == null) continue;
              const content = model.getLineContent(line);
              parts.push(content.slice(line === selection.startLineNumber ? selection.startColumn - 1 : 0, line === selection.endLineNumber ? selection.endColumn - 1 : undefined));
            }
            return parts.join('\n');
          })
          .join('\n');
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      container?.addEventListener('copy', copy, true);
      disposables.push({ dispose: () => container?.removeEventListener('copy', copy, true) });
      disposables.push({ dispose: () => marks.clear() });
      disposables.push(
        view.onDidScrollChange(() => {
          if (!syncing) {
            syncing = true;
            for (const other of views) if (other !== view) other.setScrollTop(view.getScrollTop());
            syncing = false;
          }
          schedule();
        }),
        view.onDidLayoutChange(schedule),
      );
    });
    renderMargins();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      widgets.forEach(({ view, widget }) => view.removeGlyphMarginWidget(widget));
      disposables.forEach((item) => item.dispose());
    };
  }, [left, right, rows, props.unified, props.singleSide]);
  useEffect(() => {
    if (props.singleSide === 'right' ? !right : !left || (!props.unified && !props.singleSide && !right)) return;
    const zones: Array<{ view: monaco.editor.IStandaloneCodeEditor; id: string; row: number; node: HTMLElement; height: number }> = [];
    const views = props.singleSide === 'right' ? [right!] : props.unified || props.singleSide === 'left' ? [left!] : [left!, right!];
    const rowIds = [...new Set(comments.map((comment) => comment.row))];
    for (const row of rowIds)
      views.forEach((view, index) => {
        const node = document.createElement('div');
        node.className = 'code-diff-annotation';
        comments.filter((item) => item.row === row && (props.unified || item.side === (props.singleSide === 'right' ? 'right' : index === 0 ? 'left' : 'right'))).forEach((item) => node.append(item.element));
        view.changeViewZones((accessor) => {
          zones.push({ view, row, node, height: 1, id: accessor.addZone({ afterLineNumber: row + 1, heightInPx: 1, domNode: node, suppressMouseDown: false }) });
          exposeEditorControl(view, node);
        });
      });
    const resize = new ResizeObserver(() => {
      for (const row of rowIds) {
        const pair = zones.filter((zone) => zone.row === row);
        const height = Math.max(1, ...pair.map((zone) => [...zone.node.children].reduce((sum, node) => sum + node.getBoundingClientRect().height, 0)));
        for (const zone of pair) {
          if (zone.height === height) continue;
          zone.height = height;
          zone.view.changeViewZones((accessor) => {
            accessor.removeZone(zone.id);
            zone.id = accessor.addZone({ afterLineNumber: zone.row + 1, heightInPx: height, domNode: zone.node, suppressMouseDown: false });
          });
        }
      }
    });
    comments.forEach((comment) => resize.observe(comment.body));
    return () => {
      resize.disconnect();
      zones.forEach((zone) => zone.view.changeViewZones((accessor) => accessor.removeZone(zone.id)));
    };
  }, [left, right, comments, props.unified, props.singleSide]);
  useEffect(() => {
    const target = props.focusAnnotation;
    if (!target) return;
    const comment = comments.find((item) => item.side === target.side && rows[item.row]?.[target.side === 'left' ? 'leftNumber' : 'rightNumber'] === target.line);
    if (!comment) return;
    const view = props.unified || target.side === 'left' ? left : right;
    view?.revealLineInCenter(comment.row + 1);
    const frame = requestAnimationFrame(() => comment.body.querySelector('textarea')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [props.focusAnnotation, comments, rows, left, right, props.unified]);
  return (
    <div className={'code-diff-view' + (props.unified || props.singleSide ? ' is-unified' : '')} aria-label={props.label}>
      {props.singleSide !== 'right' ? <CodeEditor path={props.file.oldPath + ':review-left'} language={detectSourceLanguage(props.file.oldPath || props.file.newPath)} content={content.left} readOnly onView={setLeft} /> : null}
      {!props.unified && props.singleSide !== 'left' ? <CodeEditor path={props.file.newPath + ':review-right'} language={detectSourceLanguage(props.file.newPath)} content={content.right} readOnly onView={setRight} /> : null}
      {linePortals.map((portal) => {
        const number = rows[portal.row]?.[portal.side === 'left' ? 'leftNumber' : 'rightNumber'];
        return createPortal(number == null ? null : (props.renderLineNumber?.(number, portal.side) ?? number), portal.element, portal.key);
      })}
      {comments.map((portal) => {
        const number = rows[portal.row]?.[portal.side === 'left' ? 'leftNumber' : 'rightNumber'];
        return createPortal(number == null ? null : props.renderLineComments?.(number, portal.side), portal.body, portal.key);
      })}
    </div>
  );
}

/** 将补丁转换成左右显示行；不截断，完整内容可滚动和复制。 */
function diffRows(file: TaskGitFileDiff, align: boolean, omitHunkHeaders: boolean): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of file.hunks) {
    if (!omitHunkHeaders) rows.push({ left: hunk.header, right: hunk.header, leftNumber: null, rightNumber: null, kind: 'header' });
    for (let index = 0; index < hunk.lines.length;) {
      const line = hunk.lines[index]!;
      if (align && (line.type === 'deletion' || line.type === 'addition')) {
        const deleted: typeof hunk.lines = [];
        const added: typeof hunk.lines = [];
        while (index < hunk.lines.length && ['deletion', 'addition'].includes(hunk.lines[index]!.type)) {
          const changed = hunk.lines[index++]!;
          (changed.type === 'deletion' ? deleted : added).push(changed);
        }
        for (let offset = 0; offset < Math.max(deleted.length, added.length); offset += 1) {
          rows.push({ left: deleted[offset]?.content ?? '', right: added[offset]?.content ?? '', leftNumber: deleted[offset]?.oldLineNumber ?? null, rightNumber: added[offset]?.newLineNumber ?? null, kind: 'replacement' });
        }
      } else {
        rows.push({ left: line.type === 'addition' ? '' : line.content, right: line.type === 'deletion' ? '' : line.content, leftNumber: line.oldLineNumber, rightNumber: line.newLineNumber, kind: line.type });
        index += 1;
      }
    }
  }
  // 二进制或仅文件模式变化的 diff 没有文本 hunk；编辑器文档仍必须至少有一行。
  if (rows.length === 0) rows.push({ left: '', right: '', leftNumber: null, rightNumber: null, kind: 'empty' });
  return rows;
}
