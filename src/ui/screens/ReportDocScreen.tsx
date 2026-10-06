import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, PixelRatio } from 'react-native';
import type { DocSection, Figure, ReportDoc } from '@/reports/doc';
import { t, bg, ink, line } from '../theme';
import { COLUMN_GAP, fitTable } from '../tableFit';
import { TAB_BAR_SPACE } from '../kit';
import { MoneyCard, ScreenHeader, SectionHeader } from '../parts';

export interface ReportDocScreenProps {
  /** Built with the on-screen formatter, so hidden amounts stay hidden here. */
  doc: ReportDoc;
  /** Saves the report as a file; the file always carries the real figures. */
  onSave?: () => void;
}

const toneClass = (tone: Figure['tone']) =>
  tone === 'in' ? ink.positive : tone === 'out' ? ink.negative : ink.primary;

const Figures: React.FC<{ figures: Figure[] }> = ({ figures }) => (
  <View className="flex-row flex-wrap" style={{ marginHorizontal: -6 }}>
    {figures.map((f) => (
      <View key={f.label} style={{ width: '50%', padding: 6 }}>
        <View className={`rounded-2xl border ${line.border} px-3.5 py-3`}>
          <Text className={t.faint}>{f.label}</Text>
          <Text
            className={`mt-1 text-[17px] font-semibold ${toneClass(f.tone)}`}
          >
            {f.value}
          </Text>
          {f.note && <Text className={`${t.faint} mt-0.5`}>{f.note}</Text>}
        </View>
      </View>
    ))}
  </View>
);

const Table: React.FC<{ section: Extract<DocSection, { kind: 'table' }> }> = ({
  section,
}) => {
  // A figure is never shrunk, wrapped or cut at the card's edge: words wrap to make room
  // (fitTable), and a table that still does not fit is shown as one block per row.
  const [width, setWidth] = useState(0);
  if (section.rows.length === 0)
    return <Text className={t.muted}>{section.empty}</Text>;
  // Values are 13 pt; headings 12 pt semibold, about as wide as 12.6 pt regular.
  const scale = PixelRatio.getFontScale();
  const fit =
    width > 0
      ? fitTable(section.columns, section.numeric, section.rows, width, 13 * scale, 12.6 * scale)
      : undefined;
  const cell = (widths: number[], i: number) => ({
    width: widths[i],
    flexGrow: i === 0 ? 1 : 0,
    marginLeft: i === 0 ? 0 : COLUMN_GAP,
  });
  const align = (i: number) => (section.numeric[i] ? 'text-right' : '');
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {fit?.kind === 'table' && (
        <>
          <View className="flex-row pb-2">
            {section.columns.map((c, i) => (
              <Text
                key={c}
                style={cell(fit.widths, i)}
                className={`${t.faint} font-semibold ${align(i)}`}
              >
                {c}
              </Text>
            ))}
          </View>
          {section.rows.map((row, r) => (
            <View key={r}>
              <View className={t.rule} />
              <View className="flex-row py-2.5">
                {row.map((value, i) => (
                  <Text
                    key={i}
                    style={cell(fit.widths, i)}
                    className={`text-[13px] ${ink.primary} ${align(i)}`}
                  >
                    {value}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </>
      )}
      {fit?.kind === 'rows' &&
        section.rows.map((row, r) => (
          <View key={r}>
            {r > 0 && <View className={t.rule} />}
            <View className="py-2.5">
              <Text className={`text-[13px] font-semibold ${ink.primary}`}>{row[0]}</Text>
              {row.slice(1).map((value, j) => (
                <View key={j} className="mt-1 flex-row justify-between" style={{ gap: COLUMN_GAP }}>
                  <Text className={t.faint}>{section.columns[j + 1]}</Text>
                  <Text className={`shrink text-right text-[13px] ${ink.primary}`}>{value}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
    </View>
  );
};

const Section: React.FC<{ section: DocSection }> = ({ section }) => (
  <View className="mb-2">
    <SectionHeader title={section.title} />
    {section.kind === 'figures' && <Figures figures={section.figures} />}
    {section.kind === 'table' && (
      <MoneyCard>
        <Table section={section} />
      </MoneyCard>
    )}
    {section.kind === 'callout' && (
      <View
        className={`rounded-3xl ${bg.muted} p-5`}
        style={{ marginBottom: 16 }}
      >
        {section.lines.map((l) => (
          <Text key={l} className={`${t.body} mb-1.5 leading-5`}>
            {l}
          </Text>
        ))}
      </View>
    )}
  </View>
);

/** One report as a document: the same sections the saved file has, drawn in the app's own look. */
export const ReportDocScreen: React.FC<ReportDocScreenProps> = ({
  doc,
  onSave,
}) => (
  <ScrollView
    className={t.screen}
    contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}
  >
    <ScreenHeader
      title={doc.title}
      subtitle={doc.subtitle}
      right={
        onSave && (
          <Pressable
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={`Save ${doc.title} as a file`}
            className={`rounded-full border ${line.border} ${bg.surface} px-4 py-2`}
          >
            <Text className={`text-[13px] font-semibold ${ink.primary}`}>
              Save
            </Text>
          </Pressable>
        )
      }
    />
    <View className={t.page}>
      {doc.sections.map((s) => (
        <Section key={s.title} section={s} />
      ))}
      <Text className={`${t.faint} mt-2 leading-4`}>{doc.footnote}</Text>
      {onSave && (
        <Text className={`${t.faint} mt-2 leading-4`}>
          Save writes this report as a web page to a folder you choose. It opens
          in any browser, and the browser's Print turns it into a PDF. The file
          is not encrypted.
        </Text>
      )}
    </View>
  </ScrollView>
);
