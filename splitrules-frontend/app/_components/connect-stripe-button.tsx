// splitrules-frontend/app/_components/connect-stripe-button.tsx
"use client";

import React from "react";
import { getOrCreateMerchantId } from "../lib/merchant-id";

type Props = {
  label?: string;
  className?: string;
};

export default function ConnectStripeButton(props: Props) {
  const { label = "Connect Stripe", className = "" } = props;

  const onClick = () => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

    if (!backendUrl) {
      alert("NEXT_PUBLIC_BACKEND_URL fehlt im Frontend (.env).");
      return;
    }

    const merchantId = getOrCreateMerchantId();
    if (!merchantId) {
      alert("Could not create merchantId.");
      return;
    }

    // IMPORTANT: go to the BACKEND route that starts Stripe OAuth
    const url =
      `${backendUrl.replace(/\/$/, "")}` +
      `/stripe/connect/start?merchantId=${encodeURIComponent(merchantId)}`;

    // Full-page redirect (works best on iPad/Safari for Stripe OAuth)
    window.location.assign(url);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.25)",
        background: "rgba(0,0,0,0.25)",
        color: "white",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}