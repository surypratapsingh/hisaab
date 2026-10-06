import { describe, it, expect } from 'vitest';
import { photoProblem, photoExtension, MAX_PHOTO_BYTES } from './photoRules';

describe('photoExtension', () => {
  it('goes by the type the phone reports, since a picked file has no extension in its address', () => {
    expect(photoExtension('image/png', 'image:1000')).toBe('.png');
    expect(photoExtension('IMAGE/JPEG', null)).toBe('.jpg');
    expect(photoExtension('image/webp', undefined)).toBe('.webp');
  });

  it('falls back to the name, and treats .jpeg as .jpg', () => {
    expect(photoExtension(null, 'Dairy Milk.JPEG')).toBe('.jpg');
    expect(photoExtension('', 'label.png')).toBe('.png');
    expect(photoExtension(undefined, '.webp')).toBe('.webp');
  });

  it('says nothing for what is not a kept kind of photo', () => {
    expect(photoExtension('application/pdf', 'bill.pdf')).toBeUndefined();
    expect(photoExtension('image/heic', 'x.heic')).toBeUndefined();
    expect(photoExtension('image/svg+xml', 'x.svg')).toBeUndefined();
    expect(photoExtension(null, null)).toBeUndefined();
    expect(photoExtension('application/octet-stream', 'archive')).toBeUndefined();
  });

  it('trusts a definite type over the name, so a renamed file cannot pass as a photo', () => {
    expect(photoExtension('application/vnd.android.package-archive', 'cute.png')).toBeUndefined();
    expect(photoExtension('application/pdf', 'cute.jpg')).toBeUndefined();
    // Only when the phone has no useful type does the name decide.
    expect(photoExtension('application/octet-stream', 'cute.png')).toBe('.png');
  });
});

describe('photoProblem', () => {
  it('accepts the photo kinds the phone shows, whatever the case', () => {
    for (const extension of ['.jpg', '.JPEG', '.png', '.webp']) expect(photoProblem(extension, 2_000_000)).toBeUndefined();
  });

  it('refuses anything else: documents, scripts, videos, and files with no extension', () => {
    for (const extension of ['.pdf', '.apk', '.js', '.mp4', '.svg', '.heic', '', undefined]) {
      expect(photoProblem(extension, 1000)).toBe('Choose a JPG, PNG or WebP photo');
    }
  });

  it('refuses a file too large to keep, and does not mind when the size is unknown', () => {
    expect(photoProblem('.jpg', MAX_PHOTO_BYTES)).toBeUndefined();
    expect(photoProblem('.jpg', MAX_PHOTO_BYTES + 1)).toContain('too large');
    expect(photoProblem('.jpg')).toBeUndefined();
  });
});
