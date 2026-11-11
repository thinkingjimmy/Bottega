/**
 * [INPUT]: Original JSON schemas and localized parameter labels.
 * [OUTPUT]: Readable parameter names, types, requirements and descriptions without changing their contracts.
 * [POS]: Tool disclosure content; full schemas remain available in a separate bounded disclosure.
 */
import { pluginDetailsCopy } from './copy';

type Schema = Record<string, unknown>;
const record = (value: unknown): Schema | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Schema : null;
function schemaType(schema: Schema): string {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.filter(item => typeof item === 'string').join(' | ');
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) return [...new Set(alternatives.map(value => record(value)?.type).filter(value => typeof value === 'string'))].join(' | ');
  return '';
}

export function PluginSchemaFields({ schema, title, locale, input = false }: { schema: Schema; title: string; locale: string; input?: boolean }) {
  const copy = pluginDetailsCopy(locale);
  const fields = Object.entries(record(schema.properties) ?? {});
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const noParameters = input && schema.type === 'object' && !fields.length && schema.additionalProperties === false && !schema.anyOf && !schema.oneOf && !schema.allOf && !schema.$ref;
  return <section className="min-w-0 space-y-2" data-plugin-schema={input ? 'input' : 'output'}>
    <h3 className="text-xs font-medium">{title}</h3>
    {typeof schema.description === 'string' && <p className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">{schema.description}</p>}
    {fields.length ? <dl className="divide-y divide-border/60">{fields.map(([name, value]) => {
      const field = record(value) ?? {};
      const type = schemaType(field);
      return <div key={name} className="min-w-0 py-2 first:pt-0 last:pb-0">
        <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <code className="text-xs font-medium wrap-anywhere">{name}</code>
          {type && <span className="text-[11px] text-muted-foreground">{type}</span>}
          <span className="text-[11px] text-muted-foreground">{required.has(name) ? copy.required : copy.optional}</span>
        </dt>
        {typeof field.description === 'string' && <dd className="mt-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere">{field.description}</dd>}
      </div>;
    })}</dl> : <p className="text-xs text-muted-foreground">{noParameters ? copy.noParameters : schemaType(schema) || copy.unspecified}</p>}
  </section>;
}
