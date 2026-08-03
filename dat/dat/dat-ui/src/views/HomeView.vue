<script setup>
import ChatInterface from '../components/ChatInterface.vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { ConfigProvider } from 'ant-design-vue'
</script>

<template>
  <config-provider :locale="zhCN">
    <ChatInterface />
  </config-provider>
</template>
