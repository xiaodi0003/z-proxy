<template>
  <el-container class="basic-layout">
    <el-aside :width="collapsed ? '64px' : '200px'" class="sidebar">
      <div class="logo">
        <img src="../assets/logo.svg" alt="logo" />
        <h1 v-if="!collapsed">z-proxy</h1>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        router
      >
        <el-menu-item index="/http-list">
          <el-icon><Document /></el-icon>
          <template #title>{{ t('menu.list.http-list') }}</template>
        </el-menu-item>
        <el-menu-item index="/dynamic-proxy">
          <el-icon><Setting /></el-icon>
          <template #title>{{ t('menu.list.dynamicproxy') }}</template>
        </el-menu-item>
        <el-menu-item index="/bypasslist">
          <el-icon><List /></el-icon>
          <template #title>{{ t('menu.list.bypasslist') }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <el-icon class="collapse-icon" @click="toggleCollapse">
          <Fold v-if="!collapsed" />
          <Expand v-else />
        </el-icon>
        <div class="header-right">
          <SelectLang />
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useGlobalStore } from '../stores/global';
import { useI18n } from '../composables/useI18n';
import { Document, Setting, List, Fold, Expand } from '@element-plus/icons-vue';
import SelectLang from '../components/SelectLang.vue';

const route = useRoute();
const globalStore = useGlobalStore();
const { collapsed } = storeToRefs(globalStore);
const { t } = useI18n();

const activeMenu = computed(() => route.path);

const toggleCollapse = () => {
  globalStore.changeLayoutCollapsed(!collapsed.value);
};
</script>

<style scoped>
.basic-layout {
  height: 100vh;
}

.sidebar {
  background: #001529;
  transition: width 0.3s;
}

.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  padding: 16px;
  color: #fff;
}

.logo img {
  width: 32px;
  height: 32px;
}

.logo h1 {
  margin: 0 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 0 24px;
}

.collapse-icon {
  font-size: 20px;
  cursor: pointer;
}

.header-right {
  display: flex;
  align-items: center;
}

.main-content {
  background: #f0f2f5;
  padding: 0;
}

:deep(.el-menu) {
  border-right: none;
  background: #001529;
}

:deep(.el-menu-item) {
  color: rgba(255, 255, 255, 0.65);
}

:deep(.el-menu-item:hover) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

:deep(.el-menu-item.is-active) {
  color: #fff;
  background: #1890ff;
}
</style>
