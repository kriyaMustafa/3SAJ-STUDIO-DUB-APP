import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { Share, Alert, Linking, Platform } from 'react-native';

export class VideoSaveService {
  /**
   * Saves video directly to Android MediaStore/Gallery so it appears in phone's Gallery & Movies.
   */
  async saveToGallery(localVideoPath: string): Promise<boolean> {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Storage/Media permission is required to save videos to your phone gallery.'
        );
        return false;
      }

      const cleanUri = localVideoPath.startsWith('file://')
        ? localVideoPath
        : `file://${localVideoPath}`;

      const asset = await MediaLibrary.createAssetAsync(cleanUri);
      if (asset) {
        try {
          const album = await MediaLibrary.getAlbumAsync('3SAJ STUDIO');
          if (!album) {
            await MediaLibrary.createAlbumAsync('3SAJ STUDIO', asset, false);
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          }
        } catch (_) {}
        Alert.alert('✅ Saved to Gallery', 'The dubbed video is now saved in your phone Gallery & Movies!');
        return true;
      }
      return false;
    } catch (e: any) {
      console.warn('saveToGallery error:', e);
      Alert.alert('Save Failed', e.message || 'Could not save video to gallery.');
      return false;
    }
  }

  /**
   * Prompts user to pick a folder (Downloads, Movies, SD card, etc.) and copies the video via StorageAccessFramework.
   */
  async saveToCustomFolder(localVideoPath: string, fileName?: string): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) {
          return false;
        }

        const cleanUri = localVideoPath.startsWith('file://')
          ? localVideoPath
          : `file://${localVideoPath}`;

        const rawName = fileName || cleanUri.split('/').pop() || 'dubbed_video';
        const outName = rawName.replace(/\.[^/.]+$/, '');

        const newFileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permissions.directoryUri,
          outName,
          'video/mp4'
        );

        // Stream copy directly without buffering full video binary into JS heap
        // (prevents fatal OutOfMemoryError on large videos)
        try {
          await FileSystem.copyAsync({
            from: cleanUri,
            to: newFileUri,
          });
        } catch {
          // If SAF direct stream copy is restricted by OEM Android ROM, fallback safely
          const info = await FileSystem.getInfoAsync(cleanUri);
          if (info.exists && info.size && info.size < 40 * 1024 * 1024) {
            const base64Data = await FileSystem.readAsStringAsync(cleanUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.writeAsStringAsync(newFileUri, base64Data, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } else {
            // For large videos, save directly to phone's public Movies/Gallery
            return await this.saveToGallery(localVideoPath);
          }
        }

        Alert.alert('✅ Download Complete', 'Video successfully saved to your selected folder!');
        return true;
      } else {
        return await this.saveToGallery(localVideoPath);
      }
    } catch (e: any) {
      console.warn('saveToCustomFolder error:', e);
      Alert.alert('Download Error', e.message || 'Could not save to selected folder.');
      return false;
    }
  }

  /**
   * Shares video using native Android Sharesheet with a valid content:// URI.
   */
  async shareVideo(localVideoPath: string, title?: string): Promise<void> {
    try {
      const cleanUri = localVideoPath.startsWith('file://')
        ? localVideoPath
        : `file://${localVideoPath}`;

      let shareUrl = cleanUri;
      if (Platform.OS === 'android') {
        try {
          shareUrl = await FileSystem.getContentUriAsync(cleanUri);
        } catch (_) {}
      }

      await Share.share({
        title: title || '3SAJ Studio Dubbed Video',
        message: title || 'Khmer Dubbed Video from 3SAJ Studio',
        url: shareUrl,
      });
    } catch (e) {
      console.warn('Share error:', e);
    }
  }

  /**
   * Prompts standard action sheet / options dialog for an exported video.
   */
  promptVideoActions(localVideoPath: string, fileName?: string) {
    Alert.alert(
      '🎬 Dubbed Video Actions',
      'What would you like to do with this video?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '💾 Save to Gallery',
          onPress: () => this.saveToGallery(localVideoPath),
        },
        {
          text: '📁 Download to Folder',
          onPress: () => this.saveToCustomFolder(localVideoPath, fileName),
        },
        {
          text: '📤 Share Video',
          onPress: () => this.shareVideo(localVideoPath, fileName),
        },
      ]
    );
  }
}

export const videoSaveService = new VideoSaveService();
