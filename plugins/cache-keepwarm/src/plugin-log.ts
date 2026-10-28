// The plugin log: append-only level files under one directory (plugins/CLAUDE.md § Logging). No engine or Node APIs here.
export const PLUGIN_LOG_CAP_BYTES = 20_971_520;
export const ROW_MAX_BYTES = 4096;
export type Level = 'error' | 'warning' | 'info';
export type LevelFields = { plugin: string; level: Level; event: string; msg: string; where: string; session?: string; detail?: Record<string, unknown> };
export type Run = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
export type FlushResult = { written: number; dropped: number; error?: string };

export function pluginLogDir(dir: string | undefined, home: string | undefined, plugin: string): string | undefined {
  if (dir) return `${dir.replace(/\/+$/, '')}/${plugin}`;
  if (home) return `${home.replace(/\/+$/, '')}/.local/state/${plugin}/logs`;
  return undefined;
}

/** UTF-8 bytes without Node's Buffer or a DOM TextEncoder. */
function byteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Contract key order is explicit; the byte bound includes the newline. */
export function levelRow(fields: LevelFields, nowMs: number): string {
  const record = {
    ts: new Date(nowMs).toISOString(), plugin: fields.plugin, level: fields.level,
    event: fields.event, msg: fields.msg, where: fields.where,
    ...(fields.session !== undefined ? { session: fields.session } : {}), detail: fields.detail ?? {},
  };
  let text = `${JSON.stringify(record)}\n`;
  const bytes = byteLength(text);
  if (bytes <= ROW_MAX_BYTES) return text;
  record.detail = { truncated: true, bytes };
  // Component/event/session identifiers are bounded too, so arbitrary input
  // cannot defeat the row bound after its detail and message are shortened.
  record.plugin = record.plugin.slice(0, 64);
  record.event = record.event.slice(0, 128);
  record.where = record.where.slice(0, 128);
  if ('session' in record && record.session) record.session = record.session.slice(0, 64);
  const chars = Array.from(record.msg);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    record.msg = chars.slice(0, mid).join('');
    if (byteLength(`${JSON.stringify(record)}\n`) <= ROW_MAX_BYTES) low = mid;
    else high = mid - 1;
  }
  record.msg = chars.slice(0, low).join('');
  text = `${JSON.stringify(record)}\n`;
  return text;
}

/** Rows travel only as argv, never interpolated into executable shell text. */
export const APPEND_SCRIPT = `set -eu
umask 077
dir=$1
plugin=$2
shift 2
refuse() { printf 'plugin log %s: %s\\n' "$1" "$2" >&2; exit 1; }
case "$plugin" in *[!a-z0-9-]*|'') refuse "$dir" 'invalid plugin';; esac
mkdir -p "$dir" || refuse "$dir" 'directory creation failed'
cap_file() {
  cap_path=$dir/$1
  [ -f "$cap_path" ] || return 1
  cap_bytes=$(wc -c < "$cap_path") || refuse "$cap_path" 'size check failed'
  [ "$cap_bytes" -gt ${PLUGIN_LOG_CAP_BYTES} ] || return 1
  mv -f "$cap_path" "$cap_path.1" || refuse "$cap_path" 'cap rename failed'
}
render_notice() {
  printf '{"ts":%s,"plugin":"%s","level":"warning","event":"log-capped","msg":"%s","where":"src/plugin-log.ts#APPEND_SCRIPT"%s,"detail":%s}\\n' "$ts" "$plugin" "$notice_msg" "$session" "$notice_detail"
}
cap_notice() {
  notice_file=$1
  notice_bytes=$2
  session=$row_session
  notice_msg='level file moved to .1 at the size cap'
  notice_detail='{"file":"'"$notice_file"'","bytes":'"$notice_bytes"'}'
  notice=$(render_notice)
  notice_size=$(($(printf '%s' "$notice" | wc -c) + 1))
  if [ "$notice_size" -gt 4096 ]; then
    notice_detail='{"truncated":true,"bytes":'"$notice_size"'}'
    if [ -n "$session" ]; then
      # Retain a valid JSON string prefix: escapes, surrogate pairs and UTF-8
      # sequences are indivisible tokens. The encoded value is stdin data.
      short=$(printf '%s' "$value" | LC_ALL=C awk '
        BEGIN { for (n=0; n<256; n++) ord[sprintf("%c", n)]=n }
        {
          out="\\""; used=2
          for (i=2; i<length($0); i+=width) {
            ch=substr($0,i,1); width=1
            if (ch=="\\\\") {
              width=2
              if (substr($0,i+1,1)=="u") {
                width=6
                if (substr($0,i+2,4) ~ /^[dD][89aAbB][0-9a-fA-F][0-9a-fA-F]$/ && substr($0,i+6,2)=="\\\\u" && substr($0,i+8,4) ~ /^[dD][cCdDeEfF][0-9a-fA-F][0-9a-fA-F]$/) width=12
              }
            } else if (ord[ch]>=240) width=4
            else if (ord[ch]>=224) width=3
            else if (ord[ch]>=192) width=2
            if (used+width>512) break
            out=out substr($0,i,width); used+=width
          }
          printf "%s\\"", out
        }')
      session=',"session":'"$short"
    fi
    notice=$(render_notice)
    while [ "$(($(printf '%s' "$notice" | wc -c) + 1))" -gt 4096 ]; do
      [ -n "$notice_msg" ] || refuse "$dir/warnings.jsonl" 'cap notice cannot fit row bound'
      notice_msg=\${notice_msg%?}
      notice=$(render_notice)
    done
  fi
  # Rotation here is deliberately non-recursive: never append a second notice
  # to an oversized warnings file, or recursively log this auxiliary rotation.
  cap_file warnings.jsonl || :
  printf '%s\\n' "$notice" >> "$dir/warnings.jsonl"
}
while [ "$#" -gt 0 ]; do
  target=$1
  row=$2
  shift 2
  case "$target" in errors.jsonl|warnings.jsonl|info.jsonl) ;; *) refuse "$dir" 'invalid level file';; esac
  body=\${row%?}
  body=\${body%?}
  head=\${body%%',"detail":'*}
  ts=\${head#'{"ts":'}
  ts=\${ts%%',"plugin":'*}
  session=''
  value=''
  case "$head" in *',"session":'*) value=\${head##*',"session":'}; session=',"session":'"$value";; esac
  row_session=$session
  if cap_file warnings.jsonl; then cap_notice warnings.jsonl "$cap_bytes"; fi
  if [ "$target" != warnings.jsonl ] && cap_file "$target"; then cap_notice "$target" "$cap_bytes"; fi
  if [ "$target" = warnings.jsonl ]; then cap_file warnings.jsonl || :; fi
  printf '%s' "$row" >> "$dir/$target"
done`;

export function appendArgv(dir: string, plugin: string, rows: string[]): string[][] {
  const batches: string[][] = [];
  const files = { error: 'errors.jsonl', warning: 'warnings.jsonl', info: 'info.jsonl' };
  for (let start = 0; start < rows.length; start += 64) {
    const argv = ['/bin/sh', '-c', APPEND_SCRIPT, 'plugin-log', dir, plugin];
    for (const row of rows.slice(start, start + 64)) {
      const level: unknown = JSON.parse(row).level;
      if (level !== 'error' && level !== 'warning' && level !== 'info') throw new Error('invalid plugin log level');
      argv.push(files[level], row);
    }
    batches.push(argv);
  }
  return batches;
}

/** A serial chain: one line per failing streak (the log is off or failing), re-armed by the next success; a lost row is never shown, and an error is shown by its emitter. */
export class PluginLogQueue {
  private pending: string[] = [];
  private chain: Promise<FlushResult> = Promise.resolve({ written: 0, dropped: 0 });
  private failing = false;
  constructor(private readonly dir: string | undefined, private readonly plugin: string) {}
  add(row: string): void { this.pending.push(row); }

  flush(run?: Run, fallback?: (line: string) => void): Promise<FlushResult> {
    const rows = this.pending.splice(0);
    if (rows.length === 0) return this.chain;
    this.chain = this.chain.then(async () => {
      let written = 0;
      try {
        if (!this.dir) throw new Error('no PLUGIN_LOG_DIR and no HOME');
        if (!run) throw new Error('process.run unavailable; fs.write replaces whole files and cannot provide append/private modes/.1 rename');
        for (const argv of appendArgv(this.dir, this.plugin, rows)) {
          const result = await run(argv);
          if (!result || typeof result.exitCode !== 'number') throw new Error('process.run returned an invalid result');
          if (result.exitCode !== 0) throw new Error(result.stderr?.split('\n')[0] || `process exited ${result.exitCode}`);
          written += (argv.length - 6) / 2;
        }
        this.failing = false;
        return { written, dropped: 0 };
      } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0]!;
        const dropped = rows.length - written;
        if (!this.failing) {
          this.failing = true;
          const line = this.dir ? `plugin log ${this.dir} failed: ${reason}; dropped ${dropped} row(s)` : `plugin log off: ${reason}; dropped ${dropped} row(s)`;
          try { fallback?.(line); } catch { /* The screen is the last fallback; never break the hook. */ }
        }
        return { written, dropped, error: reason };
      }
    });
    return this.chain;
  }
}
