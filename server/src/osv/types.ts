export interface OsvAffected {
  package?: { ecosystem?: string; name?: string };
  ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }> }>;
  versions?: string[];
}

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string; cwe_ids?: string[] } & Record<string, unknown>;
  affected?: OsvAffected[];
  references?: Array<{ type?: string; url?: string }>;
}
