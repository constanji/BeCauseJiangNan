<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  LayoutOutlined,
  ProjectOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  MessageOutlined,
  SettingOutlined,
  FileSearchOutlined,
} from '@ant-design/icons-vue'

const router = useRouter()
const route = useRoute()

const collapsed = ref(false)

const selectedKeys = computed(() => {
  const path = route.path
  if (path.startsWith('/projects')) return ['projects']
  if (path.startsWith('/datasources')) return ['datasources']
  if (path.startsWith('/models')) return ['models']
  if (path.startsWith('/chat')) return ['chat']
  if (path.startsWith('/content-store')) return ['content-store']
  return ['dashboard']
})

const menuItems = [
  {
    key: 'dashboard',
    icon: () => h(LayoutOutlined),
    label: '仪表盘',
    onClick: () => router.push('/'),
  },
  {
    key: 'projects',
    icon: () => h(ProjectOutlined),
    label: '项目管理',
    onClick: () => router.push('/projects'),
  },
  {
    key: 'datasources',
    icon: () => h(DatabaseOutlined),
    label: '数据源管理',
    onClick: () => router.push('/datasources'),
  },
  {
    key: 'content-store',
    icon: () => h(FileSearchOutlined),
    label: '内容管理',
    onClick: () => router.push('/content-store'),
  },
  {
    key: 'chat',
    icon: () => h(MessageOutlined),
    label: '问数对话',
    onClick: () => router.push('/chat'),
  },
]

import { h } from 'vue'
</script>

<template>
  <a-layout style="min-height: 100vh">
    <!-- 侧边栏 -->
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      :width="220"
      theme="dark"
    >
      <div class="logo">
        <img src="@/assets/logo.svg" alt="DAT" v-if="!collapsed" />
        <span v-if="!collapsed">DAT</span>
        <span v-else>D</span>
      </div>
      <a-menu
        v-model:selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
        :items="menuItems"
      />
    </a-layout-sider>

    <!-- 主内容区 -->
    <a-layout>
      <a-layout-header class="header">
        <a-breadcrumb style="margin: 16px 0">
          <a-breadcrumb-item>
            <router-link to="/">首页</router-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item v-if="route.meta?.breadcrumb">
            {{ route.meta.breadcrumb }}
          </a-breadcrumb-item>
        </a-breadcrumb>
      </a-layout-header>
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
      <a-layout-footer class="footer">
        DAT (Data Ask Tool) ©2025 Created with ❤️
      </a-layout-footer>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  margin: 16px;
  border-radius: 8px;
  color: #fff;
  font-size: 20px;
  font-weight: bold;
  gap: 8px;
}

.logo img {
  height: 32px;
  width: 32px;
}

.header {
  background: #fff;
  padding: 0 24px;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.content {
  margin: 24px;
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  min-height: 280px;
}

.footer {
  text-align: center;
  color: #999;
}
</style>
