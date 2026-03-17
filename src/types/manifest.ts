export interface ManifestFingerprint {
  readonly js_bundle_hash?: string
  readonly api_endpoint_set_hash?: string
  readonly response_shape_hash?: string
  readonly last_validated?: string
}

export interface ManifestStats {
  readonly operation_count: number
  readonly l1_count: number
  readonly l2_count: number
  readonly l3_count: number
}

export interface Manifest {
  readonly name: string
  readonly display_name?: string
  readonly version: string
  readonly spec_version: string
  readonly compiled_at?: string
  readonly compiler_version?: string
  readonly site_url?: string
  readonly description?: string
  readonly requires_auth?: boolean
  readonly fingerprint?: ManifestFingerprint
  readonly dependencies?: Readonly<Record<string, string | readonly string[]>>
  readonly stats?: ManifestStats
  /** ISO timestamp of last successful verification */
  readonly last_verified?: string
  /** Set to true when verification fails — agent receives warning */
  readonly quarantined?: boolean
}
