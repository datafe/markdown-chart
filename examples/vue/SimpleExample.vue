<script setup lang="ts">
import { MarkdownChart } from '@datafe/markdown-chart-vue';

defineProps<{ source: string }>();
</script>

<template>
  <MarkdownChart :source="source" />
</template>
