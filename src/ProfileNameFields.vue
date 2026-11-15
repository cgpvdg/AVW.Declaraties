<script setup>
const name = defineModel({ required: true })
defineProps({ disabled: Boolean })
</script>

<template>
  <label>Voornaam<input v-model.trim="name.firstName" autocomplete="given-name" :disabled="disabled" required maxlength="120"></label>
  <label>Tussenvoegsels<input v-model.trim="name.namePrefix" :disabled="disabled" maxlength="120"></label>
  <label>Achternaam<input v-model.trim="name.lastName" autocomplete="family-name" :disabled="disabled" required maxlength="120"></label>
</template>
