export type ShopRow = Record<string, unknown>;

export type ShopState = {
  orders: ShopRow[];
  stock: ShopRow[];
  tickets: ShopRow[];
  users: ShopRow[];
  backend: string;
  message?: string;
  error?: string;
};

async function parseShopResponse(res: Response): Promise<ShopState> {
  const data = (await res.json().catch(() => ({}))) as ShopState & {
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.detail || "Request failed");
  }
  return data;
}

export async function postShop(
  path: string,
  body: Record<string, unknown>,
): Promise<ShopState> {
  return parseShopResponse(
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
