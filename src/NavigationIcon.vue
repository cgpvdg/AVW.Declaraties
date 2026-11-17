<script setup>
defineProps({ name: { type: String, required: true } })

const paths = {
  notifications: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  declarations: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
  overview: 'M4 6h16v14H4zM4 10h16M8 4v4m8-4v4M8 14h3m2 3h3',
  annual: 'M4 6h16v14H4zM4 10h16M8 4v4m8-4v4M8 17v-3m4 3v-4m4 4v-2',
  matrix: 'M4 5h16v14H4zM4 10h16M4 14h16M9 5v14m6-14v14',
  trainers: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-4M13 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zm3-3a3.5 3.5 0 0 1 0 7',
  rates: 'M18 5a7 7 0 1 0 0 14M4 10h10m-10 4h9',
  switch: 'M4 8h15l-4-4m5 12H5l4 4',
  recurring: 'M4 11V8a3 3 0 0 1 3-3h13m-4-4 4 4-4 4m4 4v3a3 3 0 0 1-3 3H4m4-4-4 4 4 4',
  profile: 'M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  logout: 'M11 4H5v16h6m2-8h8m-4-4 4 4-4 4',
}
</script>

<template>
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
    <path :d="paths[name]" />
  </svg>
</template>
