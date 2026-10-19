<script setup lang="ts">
import { computed, useAttrs } from "vue";
import type { FunctionalComponent } from "vue";
import type { LucideProps } from "lucide-vue-next";
import {
  AlignHorizontalSpaceAround,
  AppWindow,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  CircleCheckBig,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileCode,
  FileInput,
  FileOutput,
  FileText,
  FileType,
  Image,
  Folder,
  FolderOpen,
  FolderPlus,
  Github,
  Keyboard,
  Languages,
  ListTree,
  LocateFixed,
  Lock,
  LockOpen,
  Minus,
  Palette,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Square,
  SquarePen,
  SquareSquare,
  Type,
  Trash2,
  WandSparkles,
  X,
  Plus,
} from "lucide-vue-next";

const iconMap = {
  "app-window": AppWindow,
  "arrow-right": ChevronRight,
  bookmark: Bookmark,
  "check-circle": CircleCheckBig,
  "circle-check": CircleCheckBig,
  "chevron-down": ChevronDown,
  "chevrons-down-up": ChevronsDownUp,
  "chevrons-up-down": ChevronsUpDown,
  close: X,
  "config-props": Settings2,
  document: FileText,
  "document-copy": Copy,
  download: Download,
  edit: SquarePen,
  fanyi: Languages,
  "folder-copy": Folder,
  "folder-opened": FolderOpen,
  "folder-plus": FolderPlus,
  github: Github,
  html: FileCode,
  input: FileInput,
  link: ExternalLink,
  "List-outlined": ListTree,
  locate: LocateFixed,
  lock: Lock,
  "lock-open": LockOpen,
  markdown: FileCode,
  max: Square,
  min: Minus,
  normal: SquareSquare,
  pdf: FileArchive,
  plus: Plus,
  refresh: RefreshCw,
  save: Save,
  script: Sparkles,
  search: Search,
  type: Type,
  waiguan: Palette,
  "warning-outline": CircleAlert,
  "word-file": FileType,
  "export-file": FileOutput,
  "shortcut-key": Keyboard,
  "magic-wand": WandSparkles,
  "image-config": FileOutput,
  image: Image,
  trash: Trash2,
  pangu: AlignHorizontalSpaceAround,
} satisfies Record<string, FunctionalComponent<LucideProps>>;

type AppIconName = keyof typeof iconMap;

const props = withDefaults(
  defineProps<{
    name: AppIconName;
    size?: number | string;
    strokeWidth?: number | string;
  }>(),
  {
    size: "1em",
    strokeWidth: 1.8,
  }
);

const attrs = useAttrs();
const iconComponent = computed(() => iconMap[props.name]);
</script>

<template>
  <component :is="iconComponent" v-bind="attrs" :size="size" :stroke-width="strokeWidth" />
</template>
