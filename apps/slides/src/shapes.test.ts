import { buildPresentation, parseZip } from '@aiden0z/pptx-renderer';
import { describe, expect, it } from 'vitest';
import { contentTypeOf, openPackage, related, savePackage, textOf } from './pkg';
import { deleteShape, fit, insertPicture, isAnimated, replacePicture, setBounds } from './shapes';
import { PNG, SAMPLE, makePptx } from './testing/makePptx';

const sample = async () => openPackage(await makePptx(SAMPLE));
const readsBack = async (bytes: Uint8Array) => buildPresentation(await parseZip(bytes.slice().buffer));

describe('shapes', () => {
  it('moves and resizes a shape', async () => {
    const pkg = await sample();
    const next = setBounds(pkg, 'ppt/slides/slide2.xml', '4', { x: 100, y: 200, w: 300, h: 400 });
    expect(textOf(next, 'ppt/slides/slide2.xml')).toContain('<a:off x="100" y="200"/><a:ext cx="300" cy="400"/>');
    await readsBack(await savePackage(next));
  });

  it('gives a placeholder that inherits its position a transform of its own', async () => {
    const pkg = await sample();
    const xml = textOf(pkg, 'ppt/slides/slide1.xml')!.replace(/<p:spPr><a:xfrm><a:off x="838200" y="365125"\/><a:ext cx="10515600" cy="1325563"\/><\/a:xfrm><\/p:spPr>/, '<p:spPr/>');
    const { withParts } = await import('./pkg');
    const inherited = withParts(pkg, { 'ppt/slides/slide1.xml': xml });
    const next = setBounds(inherited, 'ppt/slides/slide1.xml', '2', { x: 1, y: 2, w: 3, h: 4 });
    expect(textOf(next, 'ppt/slides/slide1.xml')).toContain('<p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr>');
  });

  it('deletes an animated shape with its animation', async () => {
    const pkg = await sample();
    expect(isAnimated(pkg, 'ppt/slides/slide1.xml', '2')).toBe(true);
    const next = deleteShape(pkg, 'ppt/slides/slide1.xml', '2');
    const xml = textOf(next, 'ppt/slides/slide1.xml')!;
    expect(xml).not.toContain('<p:timing');
    expect(xml).not.toContain('Quarterly review');
    // The transition isn't an animation of the shape: it stays.
    expect(xml).toContain('<p:transition spd="med"><p:fade/></p:transition>');
    await readsBack(await savePackage(next));
  });

  it('deletes a picture and the image only it used', async () => {
    const pkg = await sample();
    const next = deleteShape(pkg, 'ppt/slides/slide2.xml', '4');
    expect(next.parts.has('ppt/media/image1.png')).toBe(false);
    expect(related(next, 'ppt/slides/slide2.xml').map((r) => r.part)).not.toContain('ppt/media/image1.png');
    await readsBack(await savePackage(next));
  });

  it('replaces a picture, fitting the new one in the old frame', async () => {
    const pkg = await sample();
    const next = replacePicture(pkg, 'ppt/slides/slide2.xml', '4', { bytes: PNG, ext: 'png', width: 200, height: 100 });
    const targets = related(next, 'ppt/slides/slide2.xml').map((r) => r.part);
    expect(targets).toContain('ppt/media/image2.png');
    expect(targets).not.toContain('ppt/media/image1.png');
    expect(next.parts.has('ppt/media/image1.png')).toBe(false);
    // A 2:1 picture in a 3600000 square frame: full width, half height, centred.
    expect(textOf(next, 'ppt/slides/slide2.xml')).toContain('<a:off x="7200000" y="2725625"/><a:ext cx="3600000" cy="1800000"/>');
    await readsBack(await savePackage(next));
  });

  it('inserts a picture with a new id and the content type it needs', async () => {
    const pkg = await sample();
    const { pkg: next, id } = insertPicture(pkg, 'ppt/slides/slide4.xml', { cx: 12192000, cy: 6858000 }, {
      bytes: PNG,
      ext: 'jpg',
      width: 100,
      height: 50,
      name: 'chart.jpg',
    });
    expect(id).toBe('3');
    expect(contentTypeOf(next, 'ppt/media/image2.jpg')).toBe('image/jpeg');
    expect(textOf(next, 'ppt/slides/slide4.xml')).toContain('descr="chart.jpg"');
    const presentation = await readsBack(await savePackage(next));
    expect(presentation.slides).toHaveLength(4);
  });

  it('fits keep proportions', () => {
    expect(fit({ x: 0, y: 0, w: 100, h: 100 }, 50, 100)).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });
});
