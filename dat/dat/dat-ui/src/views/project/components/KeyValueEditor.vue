<template>
  <div class="key-value-editor">
    <div v-for="(item, index) in items" :key="index" class="key-value-row">
      <a-input
        v-model:value="item.key"
        placeholder="键"
        class="key-input"
        @change="emitChange"
      />
      <a-input
        v-model:value="item.value"
        placeholder="值"
        class="value-input"
        @change="emitChange"
      />
      <a-button type="text" danger @click="removeItem(index)">
        <template #icon><DeleteOutlined /></template>
      </a-button>
    </div>
    <a-button type="dashed" block @click="addItem">
      <template #icon><PlusOutlined /></template>
      {{ addButtonText || '添加' }}
    </a-button>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons-vue'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  },
  addButtonText: {
    type: String,
    default: '添加'
  }
})

const emit = defineEmits(['update:modelValue'])

// 将对象转换为数组形式便于编辑
const items = ref([])

// 监听外部值变化
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && typeof newVal === 'object') {
      const entries = Object.entries(newVal)
      if (entries.length > 0) {
        items.value = entries.map(([key, value]) => ({ key, value: String(value) }))
      } else if (items.value.length === 0) {
        items.value = []
      }
    } else {
      items.value = []
    }
  },
  { immediate: true, deep: true }
)

const addItem = () => {
  items.value.push({ key: '', value: '' })
}

const removeItem = (index) => {
  items.value.splice(index, 1)
  emitChange()
}

const emitChange = () => {
  const result = {}
  items.value.forEach(item => {
    if (item.key && item.key.trim()) {
      result[item.key.trim()] = item.value
    }
  })
  emit('update:modelValue', result)
}
</script>

<style scoped>
.key-value-editor {
  width: 100%;
}

.key-value-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}

.key-input {
  flex: 1;
}

.value-input {
  flex: 2;
}
</style>
