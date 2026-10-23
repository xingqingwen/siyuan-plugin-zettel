import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

// 设置环境变量 SIYUAN_WORKSPACE 可直接构建到思源工作空间插件目录：
//   SIYUAN_WORKSPACE=/c/Users/xxx/Documents/SiYuan npm run build
const workspaceDir = process.env.SIYUAN_WORKSPACE || "";
const outDir = workspaceDir
    ? resolve(workspaceDir, "data/plugins/siyuan-plugin-zettel")
    : "dev";

export default defineConfig({
    plugins: [
        viteStaticCopy({
            targets: [
                { src: "./README.md", dest: "./" },
                { src: "./CHANGELOG.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./icon.png", dest: "./" },
                { src: "./donate.jpg", dest: "./" },
                { src: "./i18n/**", dest: "./i18n" },
            ],
        }),
    ],
    build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        sourcemap: false,
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            external: ["siyuan", "process", "module"],
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },
});
