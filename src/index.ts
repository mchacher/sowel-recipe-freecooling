/**
 * Sowel Recipe: Freecooling
 *
 * Closes all shutters in a zone (and sub-zones) before sunrise.
 * Ideal for sleeping with windows open without being woken by daylight.
 */

// ============================================================
// Types (mirrored from Sowel core)
// ============================================================

interface RecipeSlotDef {
  id: string;
  name: string;
  description: string;
  type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean" | "text" | "data-key";
  required: boolean;
  list?: boolean;
  defaultValue?: unknown;
  constraints?: { equipmentType?: string | string[]; min?: number; max?: number };
  group?: string;
}

interface RecipeLangPack {
  name: string;
  description: string;
  slots?: Record<string, { name: string; description: string }>;
  groups?: Record<string, string>;
}

interface RecipeInstanceHandle { stop(): void }

interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  slots: RecipeSlotDef[];
  i18n?: Record<string, RecipeLangPack>;
  validate(params: Record<string, unknown>, ctx: RecipeContext): void;
  createInstance(params: Record<string, unknown>, ctx: RecipeContext): RecipeInstanceHandle;
}

interface Equipment { id: string; name: string; type: string; zoneId: string; [key: string]: unknown }
interface DataBindingWithValue { alias: string; value: unknown; category: string; [key: string]: unknown }
interface EquipmentWithDetails extends Equipment {
  dataBindings: DataBindingWithValue[];
  orderBindings: { alias: string; [key: string]: unknown }[];
  computedData?: unknown[];
}
interface Zone { id: string; name: string; parentId: string | null; [key: string]: unknown }
interface ZoneAggregatedData { sunrise: string | null; sunset: string | null; [key: string]: unknown }

interface RecipeContext {
  eventBus: { onType(type: string, handler: (event: unknown) => void): () => void };
  equipmentManager: {
    getById(id: string): Equipment | null;
    getByIdWithDetails(id: string): EquipmentWithDetails | null;
    getAllWithDetails(): EquipmentWithDetails[];
    getByZone(zoneId: string): Equipment[];
    executeOrder(equipmentId: string, alias: string, value: unknown): Promise<{ success: boolean; error?: string }>;
  };
  zoneManager: {
    getAll(): Zone[];
    getById(id: string): Zone | null;
  };
  zoneAggregator: {
    getByZoneId(zoneId: string): ZoneAggregatedData | null;
  };
  logger: {
    info(obj: Record<string, unknown>, msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
    debug(obj: Record<string, unknown>, msg: string): void;
  };
  state: { get(key: string): unknown | null; set(key: string, value: unknown): void; delete(key: string): void; clear(): void };
  log: (message: string, level?: "info" | "warn" | "error") => void;
}

// ============================================================
// Constants
// ============================================================

const ROOT_ZONE_ID = "00000000-0000-0000-0000-000000000001";

// ============================================================
// Helpers
// ============================================================

/** Get all descendant zone IDs (inclusive). */
function getDescendantZoneIds(zoneId: string, allZones: Zone[]): string[] {
  const ids = [zoneId];
  const queue = [zoneId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const z of allZones) {
      if (z.parentId === current && !ids.includes(z.id)) {
        ids.push(z.id);
        queue.push(z.id);
      }
    }
  }
  return ids;
}

// ============================================================
// Recipe definition
// ============================================================

export function createRecipe(): RecipeDefinition {
  return {
    id: "freecooling",
    name: "Freecooling",
    description: "Close all shutters before sunrise — sleep with fresh air without being woken by daylight",

    slots: [
      {
        id: "zone",
        name: "Zone",
        description: "Zone (and sub-zones) where shutters will be closed",
        type: "zone",
        required: true,
      },
      {
        id: "offsetMinutes",
        name: "Offset before sunrise (min)",
        description: "Close shutters this many minutes before sunrise",
        type: "number",
        required: true,
        defaultValue: 120,
        constraints: { min: 1, max: 300 },
      },
    ],

    i18n: {
      fr: {
        name: "Freecooling",
        description: "Ferme automatiquement les volets avant le lever du soleil — dormez fenêtre ouverte sans être réveillé par le jour",
        slots: {
          zone: { name: "Zone", description: "Zone (et sous-zones) concernée" },
          offsetMinutes: { name: "Délai avant lever du soleil (min)", description: "Fermer les volets X minutes avant le lever du soleil" },
        },
      },
    },

    validate(params) {
      const offset = Number(params.offsetMinutes);
      if (!offset || offset < 1 || offset > 300) {
        throw new Error("Offset must be between 1 and 300 minutes");
      }
    },

    createInstance(params, ctx) {
      const zoneId = String(params.zone);
      const offsetMinutes = Number(params.offsetMinutes) || 120;
      let triggerTimer: ReturnType<typeof setTimeout> | null = null;
      let unsub: (() => void) | null = null;

      // ── Get all shutters in zone + sub-zones ──

      function getOpenShutters(): EquipmentWithDetails[] {
        const allZones = ctx.zoneManager.getAll();
        const zoneIds = new Set(getDescendantZoneIds(zoneId, allZones));
        const allEquipments = ctx.equipmentManager.getAllWithDetails();

        return allEquipments.filter((eq) => {
          if (eq.type !== "shutter") return false;
          if (!zoneIds.has(eq.zoneId)) return false;
          const posBinding = eq.dataBindings.find((b) => b.category === "shutter_position");
          const position = typeof posBinding?.value === "number" ? posBinding.value : null;
          return position !== null && position > 0;
        });
      }

      // ── Close shutters ──

      async function closeShutters(): Promise<void> {
        const shutters = getOpenShutters();

        if (shutters.length === 0) {
          ctx.log("Aucun volet ouvert — rien à faire");
          return;
        }

        ctx.log(`Fermeture de ${shutters.length} volet(s) — lever du soleil dans ${offsetMinutes} min`);

        for (const shutter of shutters) {
          const posBinding = shutter.dataBindings.find((b) => b.category === "shutter_position");
          const currentPos = typeof posBinding?.value === "number" ? posBinding.value : "?";

          try {
            await ctx.equipmentManager.executeOrder(shutter.id, "position", 0);
            ctx.log(`${shutter.name} fermé (était à ${currentPos}%)`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.log(`Erreur fermeture ${shutter.name}: ${msg}`, "error");
          }
        }
      }

      // ── Schedule trigger ──

      function scheduleTrigger(): void {
        if (triggerTimer) {
          clearTimeout(triggerTimer);
          triggerTimer = null;
        }

        const rootAgg = ctx.zoneAggregator.getByZoneId(ROOT_ZONE_ID);
        const sunrise = rootAgg?.sunrise;

        if (!sunrise) {
          ctx.logger.warn({}, "Sunrise data not available — will retry on sunlight.changed");
          return;
        }

        const sunriseMs = new Date(sunrise).getTime();
        const triggerMs = sunriseMs - offsetMinutes * 60 * 1000;
        const now = Date.now();
        let delay = triggerMs - now;

        if (delay < 0) {
          // Already past today's trigger time — schedule for tomorrow
          // Add ~24h and it will auto-correct on next sunlight.changed
          delay += 24 * 60 * 60 * 1000;
        }

        triggerTimer = setTimeout(() => {
          closeShutters().catch((err) =>
            ctx.logger.error({ err }, "Freecooling trigger failed"),
          );
          // Don't reschedule here — wait for sunlight.changed to get tomorrow's sunrise
        }, delay);

        const triggerTime = new Date(now + delay);
        ctx.logger.debug(
          { sunrise, triggerTime: triggerTime.toISOString(), delayMs: delay },
          "Freecooling trigger scheduled",
        );
      }

      // ── Initialize ──

      scheduleTrigger();

      // Reschedule when sunrise changes (daily)
      unsub = ctx.eventBus.onType("sunlight.changed", () => {
        scheduleTrigger();
      });

      const zoneName = ctx.zoneManager.getById(zoneId)?.name ?? zoneId;
      ctx.log(`Recette démarrée — zone ${zoneName}, fermeture ${offsetMinutes}min avant le lever du soleil`);

      return {
        stop() {
          if (triggerTimer) {
            clearTimeout(triggerTimer);
            triggerTimer = null;
          }
          if (unsub) {
            unsub();
            unsub = null;
          }
          ctx.log("Recette arrêtée");
        },
      };
    },
  };
}
