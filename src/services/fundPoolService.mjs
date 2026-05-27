import { getFundRecord, removeFundRecord, upsertFundPoolProfile } from "../data/sqliteProvider.mjs";

export function updateFundProfile(code, input = {}) {
  const fund = getFundRecord(code);
  if (!fund) {
    return {
      ok: false,
      code,
      error: "Fund not found"
    };
  }

  const profile = upsertFundPoolProfile(fund.code, {
    groupName: input.groupName,
    tags: input.tags,
    note: input.note
  });

  return {
    ok: true,
    fund: {
      ...fund,
      groupName: profile.groupName,
      tags: profile.tags,
      note: profile.note,
      profileUpdatedAt: profile.updatedAt
    }
  };
}

export function removeFundFromPool(code) {
  const removed = removeFundRecord(code);
  if (!removed) {
    return {
      ok: false,
      code,
      error: "Fund not found"
    };
  }

  return {
    ok: true,
    removed
  };
}
