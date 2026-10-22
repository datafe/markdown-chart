<script setup lang="ts">
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import { semanticExamples } from '../../shared/semantic-examples';
</script>

<template>
  <MarkdownChart :source="semanticExamples" />
</template>
