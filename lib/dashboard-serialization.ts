import type { DashboardData, SerializedDashboardData } from "@/lib/types";

export function serializeDashboardData(data: DashboardData): SerializedDashboardData {
  return {
    ...data,
    totalRevenueUpokt: data.totalRevenueUpokt.toString(),
    providers: data.providers.map((provider) => ({
      ...provider,
      revenueUpokt: provider.revenueUpokt.toString(),
      suppliers: provider.suppliers.map((supplier) => ({
        ...supplier,
        revenueUpokt: supplier.revenueUpokt?.toString(),
        stakeUpokt: supplier.stakeUpokt?.toString()
      })),
      chains: provider.chains.map((chain) => ({
        ...chain,
        revenueUpokt: chain.revenueUpokt.toString()
      }))
    })),
    services: data.services.map((service) => ({
      ...service,
      revenueUpokt: service.revenueUpokt.toString()
    }))
  };
}

export function serializePublicDashboardData(data: DashboardData): SerializedDashboardData {
  return {
    ...data,
    totalRevenueUpokt: data.totalRevenueUpokt.toString(),
    providers: data.providers.map((provider, index) => ({
      providerKey: `provider-group-${index + 1}`,
      providerLabel: `Provider group ${index + 1}`,
      providerDomain: "anonymous",
      relays: 0,
      revenueUpokt: provider.revenueUpokt.toString(),
      chainCount: 0,
      supplierCount: 0,
      suppliers: [],
      chains: []
    })),
    services: data.services.map((service) => ({
      ...service,
      revenueUpokt: service.revenueUpokt.toString()
    }))
  };
}
