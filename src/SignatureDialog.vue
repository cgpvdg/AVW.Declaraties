<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  saved: { type: String, required: true },
  busy: Boolean,
  error: String,
  label: { type: String, required: true },
})
const emit = defineEmits(['close', 'sign'])
const dialog = ref(null)
const canvas = ref(null)
const reuse = ref(Boolean(props.saved))
const hasInk = ref(false)
const canSign = computed(() => reuse.value ? Boolean(props.saved) : hasInk.value)
let pointer = null
let previousPoint = null

onMounted(() => dialog.value.showModal())

function position(event) {
  const { left, top, width, height } = canvas.value.getBoundingClientRect()
  return {
    x: (event.clientX - left) * canvas.value.width / width,
    y: (event.clientY - top) * canvas.value.height / height,
  }
}

function start(event) {
  if (props.busy || pointer !== null || event.button !== 0) return
  pointer = event.pointerId
  previousPoint = position(event)
  canvas.value.setPointerCapture(pointer)
}

function draw(event) {
  if (event.pointerId !== pointer || props.busy) return
  const point = position(event)
  if (point.x === previousPoint.x && point.y === previousPoint.y) return
  const context = canvas.value.getContext('2d')
  context.strokeStyle = '#172e36'
  context.lineWidth = 4
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(previousPoint.x, previousPoint.y)
  context.lineTo(point.x, point.y)
  context.stroke()
  previousPoint = point
  hasInk.value = true
}

function stop(event) {
  if (event.pointerId === pointer) pointer = null
}

function clear() {
  const pad = canvas.value
  pad.getContext('2d').clearRect(0, 0, pad.width, pad.height)
  hasInk.value = false
}

function sign() {
  if (props.busy || !canSign.value) return
  emit('sign', { image: reuse.value ? props.saved : canvas.value.toDataURL('image/png'), reuse: reuse.value })
}
</script>

<template>
  <dialog ref="dialog" aria-labelledby="signature-title" @cancel.prevent="!busy && emit('close')">
    <form @submit.prevent="sign">
      <div class="section-header">
        <h2 id="signature-title">{{ label }}</h2>
        <button type="button" class="secondary" :disabled="busy" @click="emit('close')">Sluiten</button>
      </div>
      <div v-if="error" class="banner error" role="alert">{{ error }}</div>
      <div v-if="saved" class="form-actions">
        <button type="button" class="secondary" :aria-pressed="reuse" :disabled="busy" @click="reuse = true">Opgeslagen handtekening</button>
        <button type="button" class="secondary" :aria-pressed="!reuse" :disabled="busy" @click="reuse = false">Nieuwe handtekening</button>
      </div>
      <img v-if="saved" v-show="reuse" class="signature-box" :src="saved" alt="Je opgeslagen handtekening">
      <template v-if="!reuse">
        <p id="signature-hint">Teken met je muis, vinger of pen in het vak.</p>
      </template>
      <canvas v-show="!reuse" ref="canvas" class="signature-box signature-pad" width="600" height="200"
        aria-label="Handtekening tekenen" @pointerdown="start" @pointermove="draw" @pointerup="stop"
        @pointercancel="stop" @lostpointercapture="stop"></canvas>
      <div class="form-actions">
        <button v-if="!reuse" type="button" class="secondary" :disabled="busy || !hasInk" @click="clear">Wissen</button>
        <button class="primary signature-confirm" :disabled="busy || !canSign">{{ label }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.signature-box {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 1;
  background: #f8fafa;
  outline: 1px solid var(--line);
  border-radius: 8px;
}
.signature-pad { touch-action: none; cursor: crosshair; }
.signature-confirm { margin-inline-start: auto; }
button[aria-pressed="true"] { border-color: var(--accent); }
</style>
