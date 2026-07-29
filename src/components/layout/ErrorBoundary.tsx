import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Surfaces a shopper reaches without ever signing in. The recovery on these
// pages must stay on the page they were reading: sending them to /dashboard
// lands on EntitlementGate, which bounces an anonymous visitor to /login — so a
// customer who hits a render error is shown a dealer sign-in form and the
// vehicle they were looking at is gone.
const CUSTOMER_PREFIXES = [
  "/v/", "/v3/", "/v-classic/", "/vehicle/", "/passport-v2/", "/passport-v3/",
  "/sign/", "/deal/", "/review/", "/install/", "/inspect/", "/title/",
  "/ready/", "/approve/", "/scan",
];

const onCustomerSurface = () => {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === "/" || CUSTOMER_PREFIXES.some((prefix) => p.startsWith(prefix));
};

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const customer = onCustomerSurface();
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground mt-2 mb-6">
              An unexpected error occurred. Your data is safe — try refreshing the page.
            </p>
            {this.state.error && !customer && (
              <div className="bg-muted rounded-lg p-3 mb-6 text-left">
                <p className="text-[10px] font-mono text-muted-foreground break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <RotateCcw className="w-4 h-4" />
              Reload this page
            </button>
            {!customer && (
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.href = "/dashboard";
                }}
                className="block mx-auto mt-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Return to Dashboard
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
