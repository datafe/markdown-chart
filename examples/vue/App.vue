<script setup lang="ts">
import AdvancedExample from './AdvancedExample.vue';
import SimpleExample from './SimpleExample.vue';
import { source } from './source';
</script>

<template>
  <main>
    <h1>Vue integration examples</h1>

    <section>
      <h2>Simple mode</h2>
      <p>The adapter owns markdown-it and creates the ECharts registry.</p>
      <SimpleExample :source="source" />
    </section>

    <section>
      <h2>Advanced mode</h2>
      <p>The host owns the markdown-it instance, plugin, and registry.</p>
      <AdvancedExample :source="source" />
    </section>
  </main>
</template>
