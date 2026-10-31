import { serializeEstimatorConfig, type EstimatorConfig } from "./estimator";

// Design-preview only. The /v/demo?preview=1 fixtures carry no store, so they
// carry no estimator either: a preview shows the Passport exactly as a store
// with the estimator off would. Adding &estimator=example attaches this
// clearly synthetic configuration so the payment module itself can be
// reviewed. These figures are illustrative, are never written anywhere and
// are not a default for any store.
export const PREVIEW_EXAMPLE_ESTIMATOR: EstimatorConfig = {
  enabled: true,
  downPayment: { mode: "percent", percent: 10, amount: null },
  shopperControls: { downPayment: true, term: true, aprOverride: true },
  rules: [
    {
      id: "preview-example",
      enabled: true,
      startYear: 2015,
      endYear: 2027,
      defaultTermMonths: 60,
      terms: [
        { months: 36, enabled: true, aprPercent: 7.5 },
        { months: 48, enabled: true, aprPercent: 7.75 },
        { months: 60, enabled: true, aprPercent: 8 },
        { months: 72, enabled: true, aprPercent: 8.5 },
      ],
    },
  ],
};

export const previewEstimatorPayload = (): Record<string, unknown> => ({ ...serializeEstimatorConfig(PREVIEW_EXAMPLE_ESTIMATOR), version: 0 });
