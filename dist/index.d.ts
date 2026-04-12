/**
 * Sowel Recipe: Freecooling
 *
 * Closes all shutters in a zone (and sub-zones) before sunrise.
 * Ideal for sleeping with windows open without being woken by daylight.
 */
interface RecipeSlotDef {
    id: string;
    name: string;
    description: string;
    type: "zone" | "equipment" | "number" | "duration" | "time" | "boolean" | "text" | "data-key";
    required: boolean;
    list?: boolean;
    defaultValue?: unknown;
    constraints?: {
        equipmentType?: string | string[];
        min?: number;
        max?: number;
    };
    group?: string;
}
interface RecipeLangPack {
    name: string;
    description: string;
    slots?: Record<string, {
        name: string;
        description: string;
    }>;
    groups?: Record<string, string>;
}
interface RecipeInstanceHandle {
    stop(): void;
}
interface RecipeDefinition {
    id: string;
    name: string;
    description: string;
    slots: RecipeSlotDef[];
    i18n?: Record<string, RecipeLangPack>;
    validate(params: Record<string, unknown>, ctx: RecipeContext): void;
    createInstance(params: Record<string, unknown>, ctx: RecipeContext): RecipeInstanceHandle;
}
interface Equipment {
    id: string;
    name: string;
    type: string;
    zoneId: string;
    [key: string]: unknown;
}
interface DataBindingWithValue {
    alias: string;
    value: unknown;
    category: string;
    [key: string]: unknown;
}
interface EquipmentWithDetails extends Equipment {
    dataBindings: DataBindingWithValue[];
    orderBindings: {
        alias: string;
        [key: string]: unknown;
    }[];
    computedData?: unknown[];
}
interface Zone {
    id: string;
    name: string;
    parentId: string | null;
    [key: string]: unknown;
}
interface ZoneAggregatedData {
    sunrise: string | null;
    sunset: string | null;
    [key: string]: unknown;
}
interface RecipeContext {
    eventBus: {
        onType(type: string, handler: (event: unknown) => void): () => void;
    };
    equipmentManager: {
        getById(id: string): Equipment | null;
        getByIdWithDetails(id: string): EquipmentWithDetails | null;
        getAllWithDetails(): EquipmentWithDetails[];
        getByZone(zoneId: string): Equipment[];
        executeOrder(equipmentId: string, alias: string, value: unknown): Promise<{
            success: boolean;
            error?: string;
        }>;
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
    state: {
        get(key: string): unknown | null;
        set(key: string, value: unknown): void;
        delete(key: string): void;
        clear(): void;
    };
    log: (message: string, level?: "info" | "warn" | "error") => void;
}
export declare function createRecipe(): RecipeDefinition;
export {};
