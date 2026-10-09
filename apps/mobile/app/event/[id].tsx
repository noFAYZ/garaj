import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { VehicleDocument, VehiclePhoto } from '@vehicle-os/contracts';
import { documentsQuery, eventQuery, photosQuery, queryKeys } from '@vehicle-os/api-client/react';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { eventEmoji } from '@/lib/emoji';
import { fileParams, pickPhoto } from '@/lib/file-picker';
import { formatDistance, formatMoney, humanise } from '@/lib/format';
import { Eyebrow, Glyph, Panel, PanelCell, SectionHeading } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty, Skeleton } from '@/lib/ui';

/**
 * One entry, in full.
 *
 * The feed shows a line each — a title, a cost, a chip — which is right for reading a year of
 * them at a glance and wrong for the moment someone asks what a service actually covered. Every
 * field the entry holds is here, with the paperwork and photographs filed against it, and the way
 * to add more of both.
 */
export default function EventScreen() {
  const { id, vehicleId } = useLocalSearchParams<{ id: string; vehicleId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const event = useQuery(eventQuery(api, vehicleId, id));
  const photos = useQuery(photosQuery(api, vehicleId));
  const documents = useQuery(documentsQuery(api, vehicleId));

  // Filed against this entry, rather than merely belonging to the same vehicle.
  const attachedPhotos = (photos.data ?? []).filter((photo) => photo.eventId === id);
  const attachedDocuments = (documents.data?.data ?? []).filter(
    (document) => document.eventId === id,
  );

  const data = event.data;
  const occurred = data ? new Date(data.occurredAt) : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.event(vehicleId, id) });
    void queryClient.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
  };

  const attach = async (source: 'camera' | 'library') => {
    try {
      const file = await pickPhoto(source);
      if (file) {
        router.push({
          pathname: '/add/photo',
          params: { vehicleId, eventId: id, ...fileParams(file) },
        });
      }
    } catch (error) {
      Alert.alert('Could not open photos', (error as Error).message);
    }
  };

  const remove = () => {
    haptic.selection();
    Alert.alert(`Delete "${data?.title ?? 'this entry'}"?`, 'It leaves the record for good.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void api.events
            .remove(vehicleId, id)
            .then(() => {
              haptic.success();
              refresh();
              router.back();
            })
            .catch((error: unknown) =>
              Alert.alert('Could not delete it', (error as Error).message),
            );
        },
      },
    ]);
  };

  if (event.isError) {
    return <Empty title="Entry not found" description="It may have been deleted." />;
  }

  return (
    <>
      <Stack.Screen options={{ title: data ? humanise(data.eventType) : 'Entry' }} />

      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page}>
        {/* The entry's own headline: what it was, and what it cost. */}
        <Rise style={[styles.head, { backgroundColor: theme.card }]}>
          <View style={[styles.marker, { backgroundColor: theme.muted }]}>
            {data ? <Glyph size={26}>{eventEmoji(data.eventType)}</Glyph> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            {data ? (
              <>
                <Eyebrow>{humanise(data.eventType)}</Eyebrow>
                <Text style={[typeScale.title, { color: theme.foreground }]}>{data.title}</Text>
              </>
            ) : (
              <>
                <Skeleton width={70} height={10} />
                <Skeleton width="70%" height={22} />
              </>
            )}
          </View>
          {data?.cost ? (
            <Text style={[typeScale.title, { color: theme.foreground }]}>
              {formatMoney(data.cost)}
            </Text>
          ) : null}
        </Rise>

        <Rise index={1}>
          <Panel>
            <PanelCell label="When" inline>
              <Text style={[typeScale.label, { color: theme.foreground }]}>
                {occurred
                  ? occurred.toLocaleDateString('en-US', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'}
              </Text>
            </PanelCell>
            {data?.odometer !== null && data !== undefined ? (
              <PanelCell label="Odometer" inline>
                <Text style={[typeScale.label, { color: theme.foreground }]}>
                  {formatDistance(data.odometer, data.odometerUnit)}
                </Text>
              </PanelCell>
            ) : null}
            {data?.engineHours !== null && data !== undefined ? (
              <PanelCell label="Engine hours" inline>
                <Text style={[typeScale.label, { color: theme.foreground }]}>
                  {data.engineHours?.toLocaleString()} h
                </Text>
              </PanelCell>
            ) : null}
            {data?.provider ? (
              <PanelCell label="Where" inline>
                <Text
                  numberOfLines={1}
                  style={[
                    typeScale.label,
                    { flex: 1, textAlign: 'right', color: theme.foreground },
                  ]}
                >
                  {data.provider}
                </Text>
              </PanelCell>
            ) : null}
          </Panel>
        </Rise>

        {data?.description ? (
          <Rise index={2} style={{ gap: spacing.sm }}>
            <SectionHeading title="Notes" />
            <View style={[styles.notes, { backgroundColor: theme.card }]}>
              <Text style={[typeScale.body, { color: theme.foreground }]}>{data.description}</Text>
            </View>
          </Rise>
        ) : null}

        <Rise index={3} style={{ gap: spacing.sm }}>
          <SectionHeading title="Photos" count={attachedPhotos.length} />
          <Attachments
            photos={attachedPhotos}
            onAdd={() =>
              Alert.alert('Add a photo', undefined, [
                { text: 'Take a photo', onPress: () => void attach('camera') },
                { text: 'Choose from library', onPress: () => void attach('library') },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
          />
        </Rise>

        {attachedDocuments.length > 0 ? (
          <Rise index={4} style={{ gap: spacing.sm }}>
            <SectionHeading title="Documents" count={attachedDocuments.length} />
            <Panel>
              {attachedDocuments.map((document) => (
                <DocumentLine key={document.id} document={document} vehicleId={vehicleId} />
              ))}
            </Panel>
          </Rise>
        ) : null}

        {/* Apart from the rest, as every destructive control in this app is. */}
        <Rise index={5} style={[styles.danger, { backgroundColor: theme.destructiveSoft }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[typeScale.label, { color: theme.destructive }]}>Delete this entry</Text>
            <Text style={[typeScale.caption, { color: theme.foreground }]}>
              Its cost leaves the totals too.
            </Text>
          </View>
          <Button label="Delete" variant="danger" onPress={remove} />
        </Rise>
      </ScrollView>
    </>
  );
}

/** The photographs filed against this entry, as a rail, with the way to add one at the end. */
function Attachments({ photos, onAdd }: { photos: VehiclePhoto[]; onAdd: () => void }) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm }}
    >
      {photos.map((photo) => (
        <View key={photo.id} style={[styles.thumb, { backgroundColor: theme.muted }]}>
          <RemoteImage
            uri={photo.thumbnailUrl}
            cacheKey={photoKey(photo, 'thumb')}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        </View>
      ))}
      <PressableScale
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="Add a photo to this entry"
        scaleTo={0.95}
        style={[styles.thumb, styles.addThumb, { borderColor: theme.border }]}
      >
        <Ionicons name="camera-outline" size={22} color={theme.mutedForeground} />
      </PressableScale>
    </ScrollView>
  );
}

function DocumentLine({ document, vehicleId }: { document: VehicleDocument; vehicleId: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        router.push({
          pathname: '/document/[id]',
          params: { id: document.id, vehicleId, title: document.title },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={document.title}
      scaleTo={0.99}
      style={[styles.documentRow, { backgroundColor: theme.card }]}
    >
      <Ionicons name="document-text-outline" size={18} color={theme.foreground} />
      <Text numberOfLines={1} style={[typeScale.label, { flex: 1, color: theme.foreground }]}>
        {document.title}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  marker: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notes: { borderRadius: radius.lg, padding: spacing.md },
  thumb: { width: 92, height: 92, borderRadius: radius.md, overflow: 'hidden' },
  addThumb: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
});
