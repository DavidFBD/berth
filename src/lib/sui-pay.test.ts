import { describe, expect, it } from "vitest";
import { ChainKeys, Sodax, SuiGrpcTransport, SuiSpokeService } from "@sodax/sdk";
import { DEPOSIT_SOURCE_CHAINS, getDepositTokens, getNativeGasToken } from "./chains";
import { sodaxConfig } from "./sodax-config";

/**
 * Paying from Sui rides @mysten/sui 2.x since @sodax/sdk 2.2: the spoke now
 * talks gRPC (SuiGrpcTransport, `grpc_url`) where 2.0.0 held a JSON-RPC
 * client. Signing and broadcasting can only be proven by a live pay (a $2
 * buy paying SUI from Sui); these pin what can be checked offline: that
 * Berth's config still builds a Sui spoke, on the mainnet fullnode, and that
 * the pay token and its gas look as they did.
 */
describe("the Sui pay path, offline", () => {
  const sodax = new Sodax(sodaxConfig);

  it("builds the Sui spoke on the gRPC transport, aimed at the mainnet fullnode", () => {
    const sui = sodax.spoke.sui;
    expect(sui).toBeInstanceOf(SuiSpokeService);
    expect(sui.transport).toBeInstanceOf(SuiGrpcTransport);
    const chain = sodax.config.getChainConfig(ChainKeys.SUI_MAINNET) as { grpc_url?: string; rpc_url?: string };
    expect(chain.grpc_url ?? chain.rpc_url).toBe("https://fullnode.mainnet.sui.io");
    expect((sui.transport as unknown as { endpoint: string }).endpoint).toBe("https://fullnode.mainnet.sui.io");
  });

  it("knows the asset manager it pays into", () => {
    const chain = sodax.config.getChainConfig(ChainKeys.SUI_MAINNET) as { addresses: { assetManager: string } };
    expect(chain.addresses.assetManager).toMatch(/^0x[0-9a-f]{64}::asset_manager::0x[0-9a-f]{64}$/);
  });

  it("is still a pay-from chain with SUI as its pay token and its gas", () => {
    expect(DEPOSIT_SOURCE_CHAINS).toContain(ChainKeys.SUI_MAINNET);
    const sui = getDepositTokens(ChainKeys.SUI_MAINNET).find((token) => token.symbol === "SUI");
    expect(sui).toMatchObject({ decimals: 9 });
    expect(sui?.address).toMatch(/::sui::SUI$/);
    expect(getNativeGasToken(ChainKeys.SUI_MAINNET)?.address).toBe(sui?.address);
  });
});
