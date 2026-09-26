import { ApiKeysClient } from "@/components/app/ApiKeysClient";
import { listApiKeys } from "@/lib/key-actions";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const keys = await listApiKeys();
  return <ApiKeysClient initialKeys={keys} />;
}
