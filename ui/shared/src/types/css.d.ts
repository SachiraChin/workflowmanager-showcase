/**
 * TypeScript declaration for CSS module imports.
 * This allows importing CSS files directly in TypeScript.
 */

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

declare module "react-image-crop/dist/ReactCrop.css";
