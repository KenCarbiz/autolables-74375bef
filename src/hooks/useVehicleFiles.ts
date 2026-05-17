import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  VehicleFile,
  StickerRecord,
  SigningRecord,
  AftermarketInstall,
  AttachedDocument,
  AttachedDocType,
  StickerType,
  DealStatus,
} from "@/types/vehicleFile";

// ──────────────────────────────────────────────────────────────
// useVehicleFiles — Supabase-backed (Wave 10), TanStack-Query-
// wrapped (Wave 14.3).
//
// One public.vehicle_files row per (tenant, VIN) with nested
// JSONB arrays for stickers / signings / aftermarket_installs /
// attached_documents. The previous hook had its own load() +
// useState; now the cache is shared with the rest of the app,
// multiple consumers (Index.tsx, SaveCarInventory.tsx,
// Admin.tsx, AuditPacket, etc.) share one in-flight fetch, and
// every mutation invalidates the cache atomically.
//
// API shape is preserved so consumers don't need changes.
// ──────────────────────────────────────────────────────────────

const generateTrackingCode = (vin: string, type: StickerType, storeId: string): string => {
  const storePrefix = (storeId || "NONE").slice(0, 4).toUpperCase();
  const vinSuffix = vin.slice(-6).toUpperCase();
  const typeCode: Record<StickerType, string> = {
    new_car_addendum: "NA",
    used_car_sticker: "US",
    used_car_addendum: "UA",
    buyers_guide: "BG",
    trade_up: "TU",
    stock_label: "SL",
  };
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  return `AC-${storePrefix}-${vinSuffix}-${typeCode[type]}-${ts}`;
};

// Simple FNV-style content hash for immutability. SHA-256 would
// be better; keeping the legacy helper shape so existing stickers
// validate. Upgrade path: swap for SubtleCrypto.digest in a
// follow-up that backfills existing hashes.
const simpleHash = (content: string): string => {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
};

const vehicleFilesKey = (storeId: string) => ["vehicle_files", storeId] as const;

export const useVehicleFiles = (storeId: string) => {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: vehicleFilesKey(storeId),
    queryFn: async (): Promise<VehicleFile[]> => {
      // RLS already scopes to the tenant; store_id filter narrows
      // to the selected store when a dealer group has multiples.
      const { data } = await (supabase as any)
        .from("vehicle_files")
        .select("*")
        .order("updated_at", { ascending: false });
      const all = (data as VehicleFile[]) || [];
      return storeId ? all.filter((f) => f.store_id === storeId) : all;
    },
    // Keep the data fresh for a minute. Mutations below invalidate
    // explicitly, so this only affects background refetch cadence.
    staleTime: 60_000,
  });

  const files = q.data ?? [];
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: vehicleFilesKey(storeId) }),
    [qc, storeId],
  );

  // Shared read-modify-write helper. All nested-array mutators
  // go through here so they share one concurrency story. Returns
  // the updated row; caller is responsible for invalidating the
  // query cache via the wrapping useMutation.
  const mutateFileImpl = useCallback(async (
    fileId: string,
    mutate: (file: VehicleFile) => Partial<VehicleFile>,
  ): Promise<VehicleFile | null> => {
    const { data: current } = await (supabase as any)
      .from("vehicle_files")
      .select("*")
      .eq("id", fileId)
      .maybeSingle();
    if (!current) return null;
    const patch = mutate(current as VehicleFile);
    const { data: updated } = await (supabase as any)
      .from("vehicle_files")
      .update(patch)
      .eq("id", fileId)
      .select()
      .single();
    return (updated as VehicleFile) || null;
  }, []);

  const getOrCreateMutation = useMutation({
    mutationFn: async (data: {
      vin: string;
      year: string;
      make: string;
      model: string;
      trim: string;
      stock_number: string;
      condition: "new" | "used" | "cpo";
      mileage: number;
      msrp?: number;
      market_value?: number;
      factory_equipment?: string[];
      created_by: string;
    }): Promise<VehicleFile | null> => {
      const { data: existing } = await (supabase as any)
        .from("vehicle_files")
        .select("*")
        .eq("vin", data.vin)
        .maybeSingle();

      if (existing) {
        const patch = {
          stock_number: data.stock_number || existing.stock_number,
          mileage: data.mileage || existing.mileage,
          msrp: data.msrp || existing.msrp,
          market_value: data.market_value || existing.market_value,
          factory_equipment: data.factory_equipment?.length
            ? data.factory_equipment
            : existing.factory_equipment,
        };
        const { data: updated } = await (supabase as any)
          .from("vehicle_files")
          .update(patch)
          .eq("id", existing.id)
          .select()
          .single();
        return (updated as VehicleFile) || (existing as VehicleFile);
      }

      const { data: inserted, error } = await (supabase as any)
        .from("vehicle_files")
        .insert({
          store_id: storeId,
          vin: data.vin,
          year: data.year,
          make: data.make,
          model: data.model,
          trim: data.trim,
          stock_number: data.stock_number,
          condition: data.condition,
          mileage: data.mileage,
          msrp: data.msrp || 0,
          market_value: data.market_value || 0,
          factory_equipment: data.factory_equipment || [],
          created_by: data.created_by,
        })
        .select()
        .single();
      if (error || !inserted) return null;
      return inserted as VehicleFile;
    },
    onSuccess: invalidate,
  });

  const registerStickerMutation = useMutation({
    mutationFn: async (args: {
      fileId: string;
      type: StickerType;
      data: {
        paper_size: string;
        products_snapshot: any[];
        base_price: number;
        accessories_total: number;
        doc_fee: number;
        printed_by: string;
      };
    }): Promise<StickerRecord | null> => {
      const { fileId, type, data } = args;
      const token = crypto.randomUUID();
      const signingUrl = typeof window !== "undefined"
        ? `${window.location.origin}/sign/${token}`
        : `/sign/${token}`;

      let createdSticker: StickerRecord | null = null;
      await mutateFileImpl(fileId, (file) => {
        const sticker: StickerRecord = {
          id: crypto.randomUUID(),
          type,
          tracking_code: generateTrackingCode(file.vin, type, storeId),
          signing_url: signingUrl,
          signing_token: token,
          printed_at: new Date().toISOString(),
          printed_by: data.printed_by,
          paper_size: data.paper_size,
          content_hash: simpleHash(JSON.stringify({
            vin: file.vin, type,
            products: data.products_snapshot,
            prices: { base: data.base_price, acc: data.accessories_total, doc: data.doc_fee },
            ts: new Date().toISOString(),
          })),
          products_snapshot: data.products_snapshot,
          totals: {
            base_price: data.base_price,
            accessories_total: data.accessories_total,
            doc_fee: data.doc_fee,
            final_price: data.base_price + data.accessories_total + data.doc_fee,
          },
          status: "printed",
        };
        createdSticker = sticker;
        return { stickers: [...file.stickers, sticker] as any };
      });
      return createdSticker;
    },
    onSuccess: invalidate,
  });

  const recordSigningMutation = useMutation({
    mutationFn: async (args: {
      fileId: string;
      stickerId: string;
      data: Omit<SigningRecord, "id" | "sticker_id" | "signed_at">;
    }): Promise<SigningRecord | null> => {
      const { fileId, stickerId, data } = args;
      let created: SigningRecord | null = null;
      await mutateFileImpl(fileId, (file) => {
        const signing: SigningRecord = {
          ...data,
          id: crypto.randomUUID(),
          sticker_id: stickerId,
          signed_at: new Date().toISOString(),
        };
        created = signing;
        return {
          signings: [...file.signings, signing] as any,
          stickers: file.stickers.map((s) =>
            s.id === stickerId ? { ...s, status: "signed" as const } : s,
          ) as any,
          deal_status: "signed",
          customer_name: data.customer_name,
        };
      });
      return created;
    },
    onSuccess: invalidate,
  });

  const updateDealStatusMutation = useMutation({
    mutationFn: async (args: { fileId: string; status: DealStatus }) => {
      await mutateFileImpl(args.fileId, () => ({ deal_status: args.status }));
    },
    onSuccess: invalidate,
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async (args: {
      fileId: string;
      data: { customer_name?: string; customer_phone?: string; customer_email?: string };
    }) => {
      const { fileId, data } = args;
      await mutateFileImpl(fileId, () => ({
        ...(data.customer_name !== undefined ? { customer_name: data.customer_name } : {}),
        ...(data.customer_phone !== undefined ? { customer_phone: data.customer_phone } : {}),
        ...(data.customer_email !== undefined ? { customer_email: data.customer_email } : {}),
      }));
    },
    onSuccess: invalidate,
  });

  const voidStickerMutation = useMutation({
    mutationFn: async (args: { fileId: string; stickerId: string; reason: string }) => {
      const { fileId, stickerId, reason } = args;
      await mutateFileImpl(fileId, (file) => ({
        stickers: file.stickers.map((s) =>
          s.id === stickerId
            ? { ...s, status: "voided" as const, voided_at: new Date().toISOString(), voided_reason: reason }
            : s,
        ) as any,
      }));
    },
    onSuccess: invalidate,
  });

  const addAftermarketMutation = useMutation({
    mutationFn: async (args: {
      fileId: string;
      data: Omit<AftermarketInstall, "id" | "created_at">;
    }): Promise<AftermarketInstall | null> => {
      const { fileId, data } = args;
      let created: AftermarketInstall | null = null;
      await mutateFileImpl(fileId, (file) => {
        const install: AftermarketInstall = {
          ...data,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        created = install;
        return {
          aftermarket_installs: [...(file.aftermarket_installs || []), install] as any,
        };
      });
      return created;
    },
    onSuccess: invalidate,
  });

  const attachDocumentMutation = useMutation({
    mutationFn: async (args: {
      fileId: string;
      doc: {
        type: AttachedDocType;
        label: string;
        data: any;
        created_by: string;
      };
    }): Promise<AttachedDocument | null> => {
      const { fileId, doc } = args;
      let created: AttachedDocument | null = null;
      await mutateFileImpl(fileId, (file) => {
        const attached: AttachedDocument = {
          id: crypto.randomUUID(),
          type: doc.type,
          label: doc.label,
          data: doc.data,
          created_at: new Date().toISOString(),
          created_by: doc.created_by,
        };
        created = attached;
        return {
          attached_documents: [...(file.attached_documents || []), attached] as any,
        };
      });
      return created;
    },
    onSuccess: invalidate,
  });

  // Preserve the public API. Each method wraps mutateAsync so
  // callers still get the awaitable Promise<T> they had before.
  const getOrCreateFile = useCallback(
    (data: Parameters<typeof getOrCreateMutation.mutateAsync>[0]) =>
      getOrCreateMutation.mutateAsync(data),
    [getOrCreateMutation],
  );

  const registerSticker = useCallback(
    (fileId: string, type: StickerType, data: {
      paper_size: string;
      products_snapshot: any[];
      base_price: number;
      accessories_total: number;
      doc_fee: number;
      printed_by: string;
    }) => registerStickerMutation.mutateAsync({ fileId, type, data }),
    [registerStickerMutation],
  );

  const recordSigning = useCallback(
    (fileId: string, stickerId: string, data: Omit<SigningRecord, "id" | "sticker_id" | "signed_at">) =>
      recordSigningMutation.mutateAsync({ fileId, stickerId, data }),
    [recordSigningMutation],
  );

  const updateDealStatus = useCallback(
    (fileId: string, status: DealStatus) =>
      updateDealStatusMutation.mutateAsync({ fileId, status }),
    [updateDealStatusMutation],
  );

  const updateCustomer = useCallback(
    (fileId: string, data: { customer_name?: string; customer_phone?: string; customer_email?: string }) =>
      updateCustomerMutation.mutateAsync({ fileId, data }),
    [updateCustomerMutation],
  );

  const voidSticker = useCallback(
    (fileId: string, stickerId: string, reason: string) =>
      voidStickerMutation.mutateAsync({ fileId, stickerId, reason }),
    [voidStickerMutation],
  );

  const addAftermarketInstall = useCallback(
    (fileId: string, data: Omit<AftermarketInstall, "id" | "created_at">) =>
      addAftermarketMutation.mutateAsync({ fileId, data }),
    [addAftermarketMutation],
  );

  const attachDocument = useCallback(
    (fileId: string, doc: { type: AttachedDocType; label: string; data: any; created_by: string }) =>
      attachDocumentMutation.mutateAsync({ fileId, doc }),
    [attachDocumentMutation],
  );

  // Pure read helpers — memoised over the cached files array.
  const findByTrackingCode = useCallback(
    (code: string): { file: VehicleFile; sticker: StickerRecord } | null => {
      for (const file of files) {
        for (const sticker of file.stickers) {
          if (sticker.tracking_code === code) return { file, sticker };
        }
      }
      return null;
    },
    [files],
  );

  const findBySigningToken = useCallback(
    (token: string): { file: VehicleFile; sticker: StickerRecord } | null => {
      for (const file of files) {
        for (const sticker of file.stickers) {
          if (sticker.signing_token === token) return { file, sticker };
        }
      }
      return null;
    },
    [files],
  );

  const findByDealQrToken = useCallback(
    (token: string): VehicleFile | null =>
      files.find((f) => f.deal_qr_token === token) || null,
    [files],
  );

  const findByVin = useCallback(
    (vin: string): VehicleFile | null =>
      files.find((f) => f.vin === vin) || null,
    [files],
  );

  const stats = useMemo(() => ({
    totalFiles: files.length,
    totalStickers: files.reduce((sum, f) => sum + f.stickers.length, 0),
    pendingSign: files.filter((f) => f.deal_status === "pending_sign").length,
    signed: files.filter((f) => f.deal_status === "signed").length,
    delivered: files.filter((f) => f.deal_status === "delivered").length,
  }), [files]);

  return {
    files,
    loading: q.isLoading,
    stats,
    getOrCreateFile,
    registerSticker,
    recordSigning,
    updateDealStatus,
    updateCustomer,
    voidSticker,
    addAftermarketInstall,
    attachDocument,
    findByTrackingCode,
    findByVin,
    findByDealQrToken,
    findBySigningToken,
  };
};
