import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = {
  children: ReactNode;
};

type State = {
  crashed: boolean;
};

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[review-error-boundary]", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      return (
        <section className="review-shell review-shell--missing" role="alert">
          <p>Something went wrong while rendering this paper.</p>
          <Link to="/app" className="review-crumb__back">
            Back to library
          </Link>
        </section>
      );
    }
    return this.props.children;
  }
}
