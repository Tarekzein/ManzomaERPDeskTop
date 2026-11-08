/** Product identity in one place so the app can be rebranded without code changes. */
export const BRAND = {
  name: 'ManzomaERP Desktop',
  nameAr: 'منظومة ERP',
  shortName: 'ManzomaERP',
  vendor: 'ManzomaTech',
  website: 'https://manzomatech.com',
  /** Folder under the OS app-data directory. Keep it fixed when rebranding: company files live there. */
  dataFolder: 'manzoma-erp-desktop',
} as const
