import { memo, useMemo, type ReactElement } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { parseDocument, type Block, type InlineSpan, type ListItem } from '../markdown';
import type { ThemeColors } from './theme';

/**
 * Bounded markdown preview. Raw HTML is never executed — unknown or malformed
 * markup stays literal text — and task checkboxes are tappable through their
 * exact source span, which the store re-validates against the current revision.
 */

export interface PreviewProps {
  content: string;
  colors: ThemeColors;
  onToggleTask: (span: { start: number; end: number }, checked: boolean) => void;
}

function Inline({ spans, colors, style }: { spans: InlineSpan[]; colors: ThemeColors; style?: object }): ReactElement {
  return (
    <Text style={[{ color: colors.text, fontSize: 15, lineHeight: 21 }, style]}>
      {spans.map((span, index) => {
        const key = `${span.kind}-${span.start}-${index}`;
        switch (span.kind) {
          case 'bold':
            return (
              <Text key={key} style={styles.bold}>
                {span.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={key} style={styles.italic}>
                {span.text}
              </Text>
            );
          case 'code':
            return (
              <Text key={key} style={[styles.code, { backgroundColor: colors.codeBackground }]}>
                {span.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={key}
                style={[styles.link, { color: colors.accent }]}
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(span.url).catch(() => undefined);
                }}
              >
                {span.text}
              </Text>
            );
          default:
            return <Text key={key}>{span.text}</Text>;
        }
      })}
    </Text>
  );
}

function TaskBox({ checked, colors }: { checked: boolean; colors: ThemeColors }): ReactElement {
  return (
    <View style={[styles.checkbox, { borderColor: checked ? colors.accent : colors.border }]}>
      {checked ? <Text style={{ color: colors.accent, fontSize: 13, lineHeight: 16 }}>✓</Text> : null}
    </View>
  );
}

function ListBlock({
  block,
  colors,
  onToggleTask,
}: {
  block: Extract<Block, { kind: 'list' }>;
  colors: ThemeColors;
  onToggleTask: PreviewProps['onToggleTask'];
}): ReactElement {
  return (
    <View style={styles.list}>
      {block.items.map((item, index) => (
        <ListItemRow key={`${item.marker}-${index}`} item={item} colors={colors} onToggleTask={onToggleTask} />
      ))}
    </View>
  );
}

function ListItemRow({
  item,
  colors,
  onToggleTask,
}: {
  item: ListItem;
  colors: ThemeColors;
  onToggleTask: PreviewProps['onToggleTask'];
}): ReactElement {
  const marker = item.task ? null : item.ordered ? `${item.index + 1}.` : '•';
  return (
    <View style={[styles.item, { paddingLeft: item.indent * 16 }]}>
      {item.task ? (
        <Text
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.task.checked }}
          accessibilityLabel={item.task.checked ? 'Completed task' : 'Open task'}
          onPress={() => onToggleTask(item.task!.span, !item.task!.checked)}
          style={styles.marker}
          suppressHighlighting
        >
          <TaskBox checked={item.task.checked} colors={colors} />
        </Text>
      ) : (
        <Text style={[styles.marker, { color: colors.muted }]}>{marker}</Text>
      )}
      <View style={styles.itemBody}>
        <Inline spans={item.spans} colors={colors} />
      </View>
    </View>
  );
}

function BlockView({
  block,
  colors,
  onToggleTask,
}: {
  block: Block;
  colors: ThemeColors;
  onToggleTask: PreviewProps['onToggleTask'];
}): ReactElement {
  switch (block.kind) {
    case 'heading': {
      const size = block.level === 1 ? 20 : block.level === 2 ? 18 : 16;
      return <Inline spans={block.spans} colors={colors} style={{ fontSize: size, lineHeight: size + 6, fontWeight: '700' }} />;
    }
    case 'hr':
      return <View style={[styles.hr, { backgroundColor: colors.border }]} />;
    case 'code':
      return (
        <View style={[styles.codeBlock, { backgroundColor: colors.codeBackground }]}>
          <Text style={[styles.code, { color: colors.text }]}>{block.text}</Text>
        </View>
      );
    case 'list':
      return <ListBlock block={block} colors={colors} onToggleTask={onToggleTask} />;
    default:
      return <Inline spans={block.spans} colors={colors} />;
  }
}

export const Preview = memo(function Preview({ content, colors, onToggleTask }: PreviewProps): ReactElement {
  const document = useMemo(() => parseDocument(content), [content]);
  return (
    <View style={styles.root} accessibilityLabel="Markdown preview">
      {document.plainFallback ? (
        <Text style={[styles.plainNotice, { color: colors.muted }]}>
          Large document: showing plain text instead of a formatted preview.
        </Text>
      ) : null}
      {document.blocks.map((block, index) => (
        <View key={`${block.kind}-${index}`} style={styles.block}>
          <BlockView block={block} colors={colors} onToggleTask={onToggleTask} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 6 },
  block: { width: '100%' },
  list: { gap: 2 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemBody: { flexShrink: 1, flexGrow: 1 },
  marker: { minWidth: 18, textAlign: 'center' },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: 'monospace' },
  link: { textDecorationLine: 'underline' },
  codeBlock: { padding: 8, borderRadius: 6 },
  hr: { height: 1, width: '100%' },
  plainNotice: { fontSize: 12 },
});
