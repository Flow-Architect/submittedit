import { getDemoDatabase } from "../../../../lib/demo/database";
import { RelayHealthService } from "../../../../lib/relay/health-service";
import { relayJson } from "../../../../lib/relay/http";
import { getRelayRuntime } from "../../../../lib/relay/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  let runtime: ReturnType<typeof getRelayRuntime> | null = null;
  try {
    runtime = getRelayRuntime();
  } catch {
    // The public health response reports configuration categorically.
  }
  const health = await new RelayHealthService({
    chain: runtime?.chain ?? null,
    configuration: runtime?.configuration ?? { chainId: 10143, lowBalanceWei: 0n },
    database: getDemoDatabase(),
    relayerConfigured: Boolean(runtime),
  }).read();
  return relayJson({ health }, { status: health.application === "OK" ? 200 : 503 });
}
