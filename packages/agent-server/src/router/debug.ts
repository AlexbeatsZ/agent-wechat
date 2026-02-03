import { router, publicProcedure } from "./trpc.js";
import { captureScreenshot } from "../lib/screenshot.js";
import { getA11yDesktop, type A11yNode } from "../lib/a11y.js";
import { z } from "zod";

/**
 * Convert A11yNode tree to ARIA-style human-readable format
 */
function treeToAria(node: A11yNode, depth: number = 0): string {
  const indent = "  ".repeat(depth);
  const bounds = node.bounds
    ? `@(${node.bounds.x},${node.bounds.y} ${node.bounds.width}x${node.bounds.height})`
    : "";
  const name = node.name ? `"${node.name}"` : "";

  let line = `${indent}- ${node.role} ${name} ${bounds}`.trimEnd();

  if (node.children && node.children.length > 0) {
    const childLines = node.children.map(c => treeToAria(c, depth + 1)).join("\n");
    return `${line}\n${childLines}`;
  }

  return line;
}

export const debugRouter = router({
  /**
   * Capture a screenshot and return as base64-encoded PNG
   */
  screenshot: publicProcedure.query(async () => {
    const base64 = await captureScreenshot();
    return { base64 };
  }),

  /**
   * Get a11y tree via dbus-next
   */
  a11y: publicProcedure
    .input(z.object({
      format: z.enum(["json", "aria"]).default("json")
    }).optional())
    .query(async ({ input, ctx }) => {
      const { tree, error } = await getA11yDesktop({
        session: ctx.session,
      });

      if (error || !tree) {
        return { tree: null, aria: null, error: error || "Failed to get a11y tree" };
      }

      const format = input?.format ?? "json";

      if (format === "aria") {
        return { tree: null, aria: treeToAria(tree), error: undefined };
      }

      // Remove parent refs for JSON serialization (circular)
      const cleanTree = JSON.parse(JSON.stringify(tree, (key, value) =>
        key === "parent" ? undefined : value
      ));

      return { tree: cleanTree, aria: null, error: undefined };
    }),
});
