/**
 * Sowel Recipe: Freecooling
 *
 * Closes all shutters in a zone (and sub-zones) before sunrise.
 * Ideal for sleeping with windows open without being woken by daylight.
 */
// ============================================================
// Constants
// ============================================================
const ROOT_ZONE_ID = "00000000-0000-0000-0000-000000000001";
// ============================================================
// Helpers
// ============================================================
/** Get all descendant zone IDs (inclusive). */
function getDescendantZoneIds(zoneId, allZones) {
    const ids = [zoneId];
    const queue = [zoneId];
    while (queue.length > 0) {
        const current = queue.shift();
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
export function createRecipe() {
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
            let triggerTimer = null;
            let unsub = null;
            // ── Get all shutters in zone + sub-zones ──
            function getOpenShutters() {
                const allZones = ctx.zoneManager.getAll();
                const zoneIds = new Set(getDescendantZoneIds(zoneId, allZones));
                const allEquipments = ctx.equipmentManager.getAllWithDetails();
                return allEquipments.filter((eq) => {
                    if (eq.type !== "shutter")
                        return false;
                    if (!zoneIds.has(eq.zoneId))
                        return false;
                    const posBinding = eq.dataBindings.find((b) => b.category === "shutter_position");
                    const position = typeof posBinding?.value === "number" ? posBinding.value : null;
                    return position !== null && position > 0;
                });
            }
            // ── Close shutters ──
            async function closeShutters() {
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
                    }
                    catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        ctx.log(`Erreur fermeture ${shutter.name}: ${msg}`, "error");
                    }
                }
            }
            // ── Schedule trigger ──
            function scheduleTrigger() {
                if (triggerTimer) {
                    clearTimeout(triggerTimer);
                    triggerTimer = null;
                }
                const rootAgg = ctx.zoneAggregator.getByZoneId(ROOT_ZONE_ID);
                const sunriseRaw = rootAgg?.sunrise;
                if (!sunriseRaw) {
                    ctx.logger.warn({}, "Sunrise data not available — will retry on sunlight.changed");
                    return;
                }
                // Sunrise can be an ISO timestamp ("2026-04-12T06:58:00Z") or a
                // time string ("06:58"). Parse both formats into today's Date.
                let sunriseDate;
                if (sunriseRaw.includes("T") || sunriseRaw.length > 10) {
                    // ISO timestamp
                    sunriseDate = new Date(sunriseRaw);
                }
                else {
                    // HH:MM or HH:MM:SS time string → convert to today's date
                    const parts = sunriseRaw.split(":").map(Number);
                    sunriseDate = new Date();
                    sunriseDate.setHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
                }
                const sunriseMs = sunriseDate.getTime();
                if (isNaN(sunriseMs)) {
                    ctx.logger.warn({ sunriseRaw }, "Invalid sunrise value — will retry on sunlight.changed");
                    return;
                }
                const triggerMs = sunriseMs - offsetMinutes * 60 * 1000;
                const now = Date.now();
                let delay = triggerMs - now;
                if (delay < 0) {
                    // Already past today's trigger time — schedule for tomorrow
                    // Add ~24h and it will auto-correct on next sunlight.changed
                    delay += 24 * 60 * 60 * 1000;
                }
                triggerTimer = setTimeout(() => {
                    closeShutters().catch((err) => ctx.logger.error({ err }, "Freecooling trigger failed"));
                    // Don't reschedule here — wait for sunlight.changed to get tomorrow's sunrise
                }, delay);
                const triggerTime = new Date(now + delay);
                ctx.logger.debug({ sunriseRaw, triggerTime: triggerTime.toISOString(), delayMs: delay }, "Freecooling trigger scheduled");
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
