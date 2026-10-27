import { createHash } from 'node:crypto';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const slugify = value => value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
export function renderImported(markdown) {
  return sanitizeHtml(marked.parse(markdown), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {a: ['href', 'title'], img: ['src', 'alt', 'title'], code: ['class']},
    allowedSchemes: ['https', 'http'],
  });
}
export function sectionsFromSource(markdown, metadata) {
  const chapters = metadata.chapters;
  if (!metadata.audio || !chapters.length || chapters[0].start !== 0 || !Number.isFinite(metadata.duration) || metadata.duration <= 0) throw Error('The lesson has no complete audio chapter list yet. Retry after it is published.');
  const markers = [...markdown.matchAll(/^## (.+)\r?$/gm)].map(m => ({title:m[1], slug:slugify(m[1]), index:m.index}));
  const used = new Set();
  const boundaries = chapters.map((chapter, index) => {
    const marker = index ? markers.find(m => m.slug === chapter.slug) : {index:0};
    if (!/^[a-z0-9-]+$/.test(chapter.slug) || used.has(chapter.slug) || !marker || !Number.isFinite(chapter.start) || chapter.start < 0 || chapter.start >= metadata.duration || (index && chapter.start <= chapters[index-1].start)) throw Error('The source chapter list does not match the article. No materials were replaced.');
    used.add(chapter.slug);
    return {...chapter, offset:marker.index};
  });
  return boundaries.map((chapter, i) => {
    const endOffset = boundaries[i+1]?.offset ?? markdown.length;
    if (endOffset <= chapter.offset) throw Error('The source chapters are out of order.');
    const text = `<!-- section: ${chapter.slug} -->\n` + markdown.slice(chapter.offset, endOffset);
    return {id:chapter.slug, slug:chapter.slug, title:chapter.title, markdown:text, html:renderImported(text), start:chapter.start, end:chapters[i+1]?.start ?? metadata.duration};
  });
}
export function imageLinks(markdown, id) {
  const images = [...markdown.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g)].map(m=>m[1]);
  return [...new Set(images)].map(url => {
    const address = new URL(url);
    if (address.origin !== 'https://hq.mega.dev' || !address.pathname.startsWith(`/figures/${id}/`) || !/\.(png|jpe?g|webp)$/.test(address.pathname)) throw Error('An illustration uses an unsupported source.');
    return {url, file: digest(url).slice(0,20) + address.pathname.match(/\.[^.]+$/)[0]};
  });
}
