/**
 * Tiny XML writer whose output is already in Canonical XML form (C14N 1.1):
 * no declaration, no insignificant whitespace, explicit end tags, attributes
 * in canonical order and canonical escaping. Because the serialized bytes are
 * canonical, the invoice hash can be computed on the string itself, and
 * removing an element (as ZATCA's transforms do) leaves no stray whitespace.
 */

/** Pre-serialized markup inserted verbatim (used only inside the signature, which is not hashed). */
export interface RawXml {
  raw: string;
}

export type XmlChild = XmlNode | RawXml | string | null | undefined | false;

export interface XmlNode {
  name: string;
  attributes: Readonly<Record<string, string>>;
  children: readonly XmlChild[];
}

export const el = (name: string, attributes: Record<string, string> = {}, ...children: XmlChild[]): XmlNode => ({
  name,
  attributes,
  children,
});

/** Element with text content; omitted entirely when the value is empty. */
export function text(name: string, value: string | number | null | undefined, attributes: Record<string, string> = {}): XmlNode | null {
  if (value === null || value === undefined || value === '') return null;
  return el(name, attributes, String(value));
}

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

/**
 * Canonical attribute order: namespace declarations first (default, then by
 * prefix), then plain attributes by name. Only un-prefixed attributes are used
 * besides xmlns, so "by name" equals C14N's (namespace URI, local name) order.
 */
function orderedAttributes(attributes: Readonly<Record<string, string>>): Array<[string, string]> {
  const entries = Object.entries(attributes);
  const rank = (name: string) => (name === 'xmlns' ? 0 : name.startsWith('xmlns:') ? 1 : 2);
  return entries.sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

export function serialize(node: XmlChild): string {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string') return escapeText(node);
  if ('raw' in node) return node.raw;
  const attributes = orderedAttributes(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
  return `<${node.name}${attributes}>${node.children.map(serialize).join('')}</${node.name}>`;
}

export const raw = (xml: string): RawXml => ({ raw: xml });

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
