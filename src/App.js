import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, FileImage, AlertCircle, MapPin, Check, Trash2, Cloud, Save, Download } from 'lucide-react';
import * as tmImage from '@teachablemachine/image';
import EXIF from 'exif-js';
import './App.css';

const TeachableMachineImageClassifier = () => {
  const [model, setModel] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelType, setModelType] = useState('teachable_machine'); // 'teachable_machine' or 'mobilenet'
  const [imageResults, setImageResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [duplicatePairs, setDuplicatePairs] = useState([]);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [error, setError] = useState('');
  
  // New state for cloud storage features
  const [cloudStorageRecords, setCloudStorageRecords] = useState([]);
  const [isCloudUploading, setIsCloudUploading] = useState(false);
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [showCloudPanel, setShowCloudPanel] = useState(false);
  
  const fileInputRef = useRef(null);

  // Backend URL
  const BACKEND_URL = 'http://localhost:8000';

  // Replace with your actual Teachable Machine model URL
  const MODEL_URL = 'https://teachablemachine.withgoogle.com/models/jAJOZ7JwZ/';

  // Check if libraries are available
  useEffect(() => {
    const checkLibraries = () => {
      try {
        if (tmImage && EXIF) {
          setLibrariesLoaded(true);
          setError('');
        } else {
          setError('Required libraries not available');
        }
      } catch (err) {
        setError('Error checking libraries: ' + err.message);
      }
    };

    checkLibraries();
    // Load cloud storage records on startup
    loadCloudStorageRecords();
  }, []);

  // Load cloud storage records from backend
  const loadCloudStorageRecords = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/cloud-storage`);
      if (response.ok) {
        const data = await response.json();
        setCloudStorageRecords(data.records || []);
      }
    } catch (error) {
      console.log('Could not load cloud storage records:', error);
    }
  };

  // Convert DMS to decimal degrees
  const convertDMSToDD = (degrees, minutes, seconds, direction) => {
    let dd = degrees + minutes/60 + seconds/(60*60);
    if (direction === 'S' || direction === 'W') {
      dd = dd * -1;
    }
    return dd;
  };

  // Extract GPS coordinates from EXIF data
  const extractGPSFromExif = async (file) => {
    return new Promise((resolve) => {
      EXIF.getData(file, function() {
        try {
          const lat = EXIF.getTag(this, 'GPSLatitude');
          const lon = EXIF.getTag(this, 'GPSLongitude');
          const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
          const lonRef = EXIF.getTag(this, 'GPSLongitudeRef');

          if (lat && lon && latRef && lonRef) {
            const latitude = convertDMSToDD(lat[0], lat[1], lat[2], latRef);
            const longitude = convertDMSToDD(lon[0], lon[1], lon[2], lonRef);
            
            console.log(`Extracted GPS: ${latitude}, ${longitude} from ${file.name}`);
            resolve({
              latitude: latitude,
              longitude: longitude
            });
          } else {
            console.log(`No GPS data found in ${file.name}`);
            resolve(null);
          }
        } catch (error) {
          console.error('Error extracting GPS data:', error);
          resolve(null);
        }
      });
    });
  };

  // Load the Teachable Machine model
  const loadModel = useCallback(async () => {
    if (model && modelType === 'teachable_machine') return model;
    if (!librariesLoaded) {
      setError('Libraries not loaded yet');
      return null;
    }

    if (modelType === 'mobilenet') {
      // For MobileNet, we don't need to load a frontend model
      return 'mobilenet';
    }

    setIsModelLoading(true);
    setError('');
    
    try {
      console.log('Loading model from:', MODEL_URL);
      const modelURL = MODEL_URL + "model.json";
      const metadataURL = MODEL_URL + "metadata.json";
      
      const loadedModel = await tmImage.load(modelURL, metadataURL);
      setModel(loadedModel);
      console.log('Model loaded successfully');
      return loadedModel;
    } catch (error) {
      console.error('Error loading model:', error);
      setError('Failed to load the model. Using fallback model for demo purposes.');
      
      // Fallback to mock model if real model fails
      const mockModel = {
        predict: async (imageElement) => {
          await new Promise(resolve => setTimeout(resolve, 500));
          const mangoProb = Math.random() * 0.6 + 0.3;
          return [
            { className: 'mango_tree', probability: mangoProb },
            { className: 'not_mango_tree', probability: 1 - mangoProb }
          ];
        }
      };
      setModel(mockModel);
      return mockModel;
    } finally {
      setIsModelLoading(false);
    }
  }, [model, librariesLoaded, modelType]);

  // Convert image to base64
  const imageToBase64 = (imageElement) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imageElement.width;
    canvas.height = imageElement.height;
    ctx.drawImage(imageElement, 0, 0);
    return canvas.toDataURL('image/jpeg');
  };

  // Process a single image through the model
  const classifyImage = async (imageElement, loadedModel) => {
    try {
      if (modelType === 'teachable_machine') {
        const predictions = await loadedModel.predict(imageElement);
        return predictions.map(pred => ({
          className: pred.className,
          probability: pred.probability
        }));
      } else if (modelType === 'mobilenet') {
        // Send to backend for MobileNetV2 classification
        const base64Image = imageToBase64(imageElement);

        const response = await fetch(`${BACKEND_URL}/classify-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_data: base64Image,
            model_type: 'mobilenet'
          })
        });

        if (response.ok) {
          const result = await response.json();
          return result.predictions;
        } else {
          throw new Error('Backend classification failed');
        }
      }
    } catch (error) {
      console.error('Error classifying image:', error);
      return null;
    }
  };

  // Send images to backend for duplicate checking
  const sendImagesToBackend = async (images) => {
    const imagesWithLocation = images.filter(img => img.location !== null);

    if (imagesWithLocation.length === 0) {
      console.log('No images with location data to send to backend');
      return;
    }

    try {
      setIsCheckingDuplicates(true);

      const locationData = imagesWithLocation.map(img => ({
        imageName: img.file.name,
        latitude: img.location.latitude,
        longitude: img.location.longitude,
        imageId: String(img.id)
      }));

      console.log(`Sending ${locationData.length} images with location data:`, locationData);

      const response = await fetch(`${BACKEND_URL}/check-proximity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locations: locationData })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Received data from backend:', data);
        
        if (data.similar_pairs) {
          setDuplicatePairs(data.similar_pairs);
        }
      } else {
        console.error('Backend error:', response.status, response.statusText);
        setError(`Backend error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error processing with backend:', error);
      setError('Failed to connect to backend. Make sure it\'s running on localhost:8000');
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  // Upload single image to cloud storage
  const uploadImageToCloud = async (result) => {
    if (!result.location) {
      setError('Image must have GPS data to upload to cloud');
      return;
    }

    setUploadProgress(prev => ({ ...prev, [result.id]: 'uploading' }));
    
    try {
      // Convert image to base64
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = result.imageUrl;
      });

      const base64Image = imageToBase64(img);

      const response = await fetch(`${BACKEND_URL}/upload-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageId: String(result.id),
          imageName: result.file.name,
          imageData: base64Image,
          latitude: result.location.latitude,
          longitude: result.location.longitude,
          metadata: {
            predictions: result.predictions,
            timestamp: result.timestamp,
            fileSize: result.file.size,
            fileType: result.file.type
          }
        })
      });

      if (response.ok) {
        const cloudResponse = await response.json();
        
        // Add to cloud storage records
        const newRecord = {
          imageId: result.id,
          imageName: result.file.name,
          cloudinaryUrl: cloudResponse.cloudinaryUrl,
          publicId: cloudResponse.publicId,
          latitude: result.location.latitude,
          longitude: result.location.longitude,
          uploadedAt: new Date(),
          size: result.file.size,
          format: result.file.type
        };
        
        setCloudStorageRecords(prev => [...prev, newRecord]);
        setUploadProgress(prev => ({ ...prev, [result.id]: 'success' }));
        
        // Clear success status after 3 seconds
        setTimeout(() => {
          setUploadProgress(prev => {
            const updated = { ...prev };
            delete updated[result.id];
            return updated;
          });
        }, 3000);
        
      } else {
        throw new Error(`Upload failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress(prev => ({ ...prev, [result.id]: 'error' }));
      setError(`Upload failed: ${error.message}`);
      
      // Clear error status after 5 seconds
      setTimeout(() => {
        setUploadProgress(prev => {
          const updated = { ...prev };
          delete updated[result.id];
          return updated;
        });
      }, 5000);
    }
  };

  // Bulk save approved images to cloud
  const bulkSaveToCloud = async () => {
    setIsBulkSaving(true);
    
    try {
      const response = await fetch(`${BACKEND_URL}/bulk-save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Bulk save result:', result);
        
        // Refresh cloud storage records
        await loadCloudStorageRecords();
        
        if (result.saved_count > 0) {
          setError(''); // Clear any previous errors
          // Show success message
          const successMsg = `Successfully saved ${result.saved_count} approved images to cloud storage!`;
          setError(successMsg);
          setTimeout(() => setError(''), 5000);
        } else {
          setError('No approved images found to save. Make decisions on duplicate pairs first.');
        }
      } else {
        throw new Error(`Bulk save failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Bulk save error:', error);
      setError(`Bulk save failed: ${error.message}`);
    } finally {
      setIsBulkSaving(false);
    }
  };

  // Handle model type change
  const handleModelTypeChange = (newModelType) => {
    setModelType(newModelType);
    setModel(null); // Reset model when switching types
    setError(''); // Clear any previous errors
  };

  // Handle file upload and processing
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setIsProcessing(true);
    setError('');

    try {
      let loadedModel = null;
      if (modelType === 'teachable_machine') {
        loadedModel = await loadModel();
        if (!loadedModel) {
          setIsProcessing(false);
          return;
        }
      } else {
        // For mobilenet, we use backend classification
        loadedModel = 'mobilenet';
      }

      const newResults = [];

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const img = new Image();
          const imageUrl = URL.createObjectURL(file);

          // Extract GPS coordinates using EXIF
          const location = await extractGPSFromExif(file);

          await new Promise((resolve, reject) => {
            img.onload = async () => {
              try {
                const predictions = await classifyImage(img, loadedModel);

                if (predictions) {
                  const result = {
                    id: Date.now() + Math.random(),
                    file: file,
                    imageUrl: imageUrl,
                    predictions: predictions,
                    timestamp: new Date().toLocaleTimeString(),
                    location: location
                  };

                  newResults.push(result);
                }
                resolve();
              } catch (err) {
                reject(err);
              }
            };
            
            img.onerror = () => {
              reject(new Error(`Failed to load image: ${file.name}`));
            };
            
            img.src = imageUrl;
          });
        }
      }

      setImageResults(prev => [...prev, ...newResults]);

      // Send images with location data to backend for duplicate checking
      if (newResults.length > 0) {
        await sendImagesToBackend(newResults);
      }

    } catch (error) {
      console.error('Error processing images:', error);
      setError('Error processing images: ' + error.message);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle duplicate resolution
  const handleDuplicateAction = async (pairId, action, imageId1, imageId2) => {
    try {
      const response = await fetch(`${BACKEND_URL}/save-decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairId: pairId,
          action: action,
          imageId1: imageId1,
          imageId2: imageId2
        })
      });

      if (response.ok) {
        setDuplicatePairs(prev => prev.filter(pair => pair.pairId !== pairId));

        if (action === 'keep_first_remove_second') {
          removeImageResult(imageId2);
        } else if (action === 'remove_first_keep_second') {
          removeImageResult(imageId1);
        }
      } else {
        setError(`Failed to save decision: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error saving decision:', error);
      setError('Failed to save decision: ' + error.message);
    }
  };

  // Remove an image result
  const removeImageResult = (id) => {
    setImageResults(prev => {
      const updated = prev.filter(result => String(result.id) !== String(id));
      const toRemove = prev.find(result => String(result.id) === String(id));
      if (toRemove) {
        URL.revokeObjectURL(toRemove.imageUrl);
      }
      return updated;
    });

    setDuplicatePairs(prev => prev.filter(pair =>
      String(pair.imageId1) !== String(id) && String(pair.imageId2) !== String(id)
    ));
  };

  // Clear all results
  const clearAllResults = () => {
    imageResults.forEach(result => URL.revokeObjectURL(result.imageUrl));
    setImageResults([]);
    setDuplicatePairs([]);
    setError('');
  };

  // Get upload button style based on status
  const getUploadButtonStyle = (resultId) => {
    const status = uploadProgress[resultId];
    const baseStyle = {
      padding: '6px 12px',
      borderRadius: '4px',
      border: 'none',
      cursor: 'pointer',
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      transition: 'all 0.2s'
    };

    switch (status) {
      case 'uploading':
        return { ...baseStyle, backgroundColor: '#f59e0b', color: 'white' };
      case 'success':
        return { ...baseStyle, backgroundColor: '#10b981', color: 'white' };
      case 'error':
        return { ...baseStyle, backgroundColor: '#ef4444', color: 'white' };
      default:
        return { ...baseStyle, backgroundColor: '#3b82f6', color: 'white' };
    }
  };

  // Get upload button text and icon
  const getUploadButtonContent = (resultId) => {
    const status = uploadProgress[resultId];
    const isAlreadyUploaded = cloudStorageRecords.some(record => String(record.imageId) === String(resultId));
    
    if (isAlreadyUploaded) {
      return { icon: <Check size={12} />, text: 'Uploaded' };
    }
    
    switch (status) {
      case 'uploading':
        return { icon: <Cloud size={12} />, text: 'Uploading...' };
      case 'success':
        return { icon: <Check size={12} />, text: 'Uploaded!' };
      case 'error':
        return { icon: <X size={12} />, text: 'Failed' };
      default:
        return { icon: <Cloud size={12} />, text: 'Upload' };
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <div className="header">
        <h1 className="app-title">
          Mango Tree Classifier with Cloud Storage
        </h1>
        <p className="app-description">
          Upload images to classify mango trees, detect nearby duplicates, and save approved images to cloud storage (Cloudinary).
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          backgroundColor: error.includes('Successfully') ? '#d1fae5' : '#fee2e2', 
          border: `1px solid ${error.includes('Successfully') ? '#10b981' : '#fca5a5'}`, 
          color: error.includes('Successfully') ? '#065f46' : '#dc2626', 
          padding: '12px 16px', 
          borderRadius: '8px', 
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center'
        }}>
          <AlertCircle style={{ marginRight: '8px' }} size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Cloud Storage Panel */}
      <div style={{ 
        marginBottom: '24px', 
        padding: '16px', 
        backgroundColor: 'white', 
        borderRadius: '8px', 
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ margin: '0', fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cloud size={20} />
            Cloud Storage ({cloudStorageRecords.length} uploaded)
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowCloudPanel(!showCloudPanel)}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                backgroundColor: 'white',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              {showCloudPanel ? 'Hide' : 'Show'} Records
            </button>
            <button
              onClick={bulkSaveToCloud}
              disabled={isBulkSaving || duplicatePairs.length > 0}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: duplicatePairs.length > 0 ? '#9ca3af' : '#10b981',
                color: 'white',
                cursor: duplicatePairs.length > 0 ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Save size={12} />
              {isBulkSaving ? 'Saving...' : 'Bulk Save Approved'}
            </button>
          </div>
        </div>
        
        <div style={{ fontSize: '12px', color: '#6b7280' }}>
          {duplicatePairs.length > 0 ? 
            '⚠️ Resolve duplicate pairs before bulk saving' : 
            '✅ Ready for bulk save operations'
          }
        </div>

        {showCloudPanel && (
          <div style={{ 
            marginTop: '12px', 
            maxHeight: '200px', 
            overflowY: 'auto', 
            border: '1px solid #e5e7eb', 
            borderRadius: '4px' 
          }}>
            {cloudStorageRecords.length > 0 ? (
              <div style={{ padding: '8px' }}>
                {cloudStorageRecords.map((record, index) => (
                  <div key={index} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '4px 0',
                    borderBottom: index < cloudStorageRecords.length - 1 ? '1px solid #f3f4f6' : 'none'
                  }}>
                    <div style={{ fontSize: '12px' }}>
                      <div style={{ fontWeight: '500' }}>{record.imageName}</div>
                      <div style={{ color: '#6b7280' }}>
                        {record.latitude?.toFixed(6)}, {record.longitude?.toFixed(6)}
                      </div>
                    </div>
                    <a 
                      href={record.cloudinaryUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ 
                        fontSize: '12px', 
                        color: '#3b82f6', 
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Download size={12} />
                      View
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                No images uploaded to cloud yet
              </div>
            )}
          </div>
        )}
      </div>

      {/* Library Status */}
      <div style={{ 
        marginBottom: '24px', 
        padding: '16px', 
        backgroundColor: 'white', 
        borderRadius: '8px', 
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ 
              width: '12px', 
              height: '12px', 
              borderRadius: '50%', 
              marginRight: '12px',
              backgroundColor: librariesLoaded ? '#10b981' : '#ef4444'
            }}></div>
            <span style={{ fontSize: '14px', color: '#6b7280' }}>
              Libraries Status: {librariesLoaded ? 'Ready ✓' : 'Not Available ✗'}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>
            TM: {tmImage ? '✓' : '✗'} | EXIF: {EXIF ? '✓' : '✗'}
          </div>
        </div>
        {librariesLoaded && (
          <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}>
            Ready to process images with real EXIF GPS extraction and AI classification
          </div>
        )}
      </div>

      {/* Model Selection */}
      <div style={{ 
        marginBottom: '24px', 
        padding: '16px', 
        backgroundColor: 'white', 
        borderRadius: '8px', 
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)' 
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>Select Classification Model:</h3>
        <div style={{ display: 'flex', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="teachable_machine"
              checked={modelType === 'teachable_machine'}
              onChange={(e) => handleModelTypeChange(e.target.value)}
              disabled={isProcessing || !librariesLoaded}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px' }}>Teachable Machine</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="mobilenet"
              checked={modelType === 'mobilenet'}
              onChange={(e) => handleModelTypeChange(e.target.value)}
              disabled={isProcessing || !librariesLoaded}
              style={{ marginRight: '8px' }}
            />
            <span style={{ fontSize: '14px' }}>Fine-tuned MobileNetV2</span>
          </label>
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
          Current model: <strong>{modelType === 'teachable_machine' ? 'Teachable Machine (with fallback)' : 'MobileNetV2 (via backend)'}</strong>
        </div>
      </div>

      {/* Upload Section */}
      <div className="upload-section">
        <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileUpload}
            className="file-input"
            disabled={isModelLoading || isProcessing || !librariesLoaded}
          />

          <div className="upload-content">
            <Upload size={48} className="upload-icon" />
            <button
              className="upload-button"
              disabled={isModelLoading || isProcessing || !librariesLoaded}
            >
              {isModelLoading ? 'Loading Model...' : 
               isProcessing ? 'Processing...' : 
               !librariesLoaded ? 'Libraries Not Ready' : 'Upload Images'}
            </button>
            <p className="upload-text">
              Select multiple image files with GPS location data (JPG, PNG, etc.)
            </p>
          </div>
        </div>
      </div>

      {/* Duplicate Pairs Section */}
      {duplicatePairs.length > 0 && (
        <div className="duplicates-section">
          <h2 className="duplicates-title">
            Nearby Mango Trees Found ({duplicatePairs.length} pairs)
            {isCheckingDuplicates && <span className="checking-text"> - Checking...</span>}
          </h2>

          {duplicatePairs.map((pair) => {
            const image1 = imageResults.find(img => String(img.id) === String(pair.imageId1));
            const image2 = imageResults.find(img => String(img.id) === String(pair.imageId2));

            if (!image1 || !image2) return null;

            return (
              <div key={pair.pairId} className="duplicate-pair">
                <div className="pair-info">
                  <p className="distance-info">
                    Distance: {pair.distance ? pair.distance.toFixed(2) : 'Unknown'}m apart
                  </p>
                </div>

                <div className="pair-images">
                  <div className="pair-image">
                    <img src={image1.imageUrl} alt={image1.file.name} />
                    <p className="image-name">{image1.file.name}</p>
                    <p className="coordinates">
                      <MapPin size={14} />
                      {image1.location ? 
                        `${image1.location.latitude.toFixed(6)}, ${image1.location.longitude.toFixed(6)}` : 
                        'Location from backend'
                      }
                    </p>
                  </div>

                  <div className="pair-image">
                    <img src={image2.imageUrl} alt={image2.file.name} />
                    <p className="image-name">{image2.file.name}</p>
                    <p className="coordinates">
                      <MapPin size={14} />
                      {image2.location ? 
                        `${image2.location.latitude.toFixed(6)}, ${image2.location.longitude.toFixed(6)}` : 
                        'Location from backend'
                      }
                    </p>
                  </div>
                </div>

                <div className="pair-actions">
                  <button
                    className="action-btn save-both"
                    onClick={() => handleDuplicateAction(pair.pairId, 'save_both', pair.imageId1, pair.imageId2)}
                  >
                    <Check size={16} />
                    <span>Save Both</span>
                  </button>
                  <button
                    className="action-btn keep-first"
                    onClick={() => handleDuplicateAction(pair.pairId, 'keep_first_remove_second', pair.imageId1, pair.imageId2)}
                  >
                    <Trash2 size={16} />
                    <span>Keep First</span>
                  </button>
                  <button
                    className="action-btn keep-second"
                    onClick={() => handleDuplicateAction(pair.pairId, 'remove_first_keep_second', pair.imageId1, pair.imageId2)}
                  >
                    <Trash2 size={16} />
                    <span>Keep Second</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Results Header */}
      {imageResults.length > 0 && (
        <div className="results-header">
          <h2 className="results-title">
            Classification Results ({imageResults.length})
            <span className="mango-count">
              {imageResults.filter(result => {
                const mangoTreePrediction = result.predictions.find(p =>
                  p.className.toLowerCase().includes('mango')
                );
                return mangoTreePrediction && mangoTreePrediction.probability > 0.5;
              }).length} mango trees detected
            </span>
          </h2>
          <button className="clear-button" onClick={clearAllResults}>
            Clear All
          </button>
        </div>
      )}

      {/* Results Grid */}
      <div className="results-grid">
        {[...imageResults]
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .map((result) => {
            const mangoTreePrediction = result.predictions.find(p =>
              p.className.toLowerCase().includes('mango')
            );
            const isMangoDetected = mangoTreePrediction && mangoTreePrediction.probability > 0.5;
            const uploadButtonContent = getUploadButtonContent(result.id);
            const isAlreadyUploaded = cloudStorageRecords.some(record => String(record.imageId) === String(result.id));

            return (
              <div key={result.id} className={`result-card ${isMangoDetected ? 'mango-detected' : ''}`}>
                <div className="image-container">
                  <img
                    src={result.imageUrl}
                    alt={result.file.name}
                    className="result-image"
                  />
                  <button
                    onClick={() => removeImageResult(result.id)}
                    className="delete-button"
                  >
                    <X size={16} />
                  </button>
                  {isMangoDetected && (
                    <div className="mango-badge">
                      Mango Tree
                    </div>
                  )}
                  {/* Cloud Upload Button */}
                  {result.location && (
                    <button
                      onClick={() => uploadImageToCloud(result)}
                      disabled={uploadProgress[result.id] === 'uploading' || isAlreadyUploaded}
                      style={{
                        ...getUploadButtonStyle(result.id),
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        opacity: isAlreadyUploaded ? 0.7 : 1,
                        cursor: isAlreadyUploaded ? 'default' : 'pointer'
                      }}
                    >
                      {uploadButtonContent.icon}
                      {uploadButtonContent.text}
                    </button>
                  )}
                </div>

                <div className="card-content">
                  <div className="file-info">
                    <FileImage size={16} className="file-icon" />
                    <span className="file-name" title={result.file.name}>
                      {result.file.name}
                    </span>
                  </div>

                  <div className="location-info">
                    <MapPin size={14} className={`location-icon ${result.location ? '' : 'no-location'}`} />
                    <span className={result.location ? '' : 'no-location-text'}>
                      {result.location ? 
                        `${result.location.latitude.toFixed(6)}, ${result.location.longitude.toFixed(6)}` : 
                        'No GPS data in EXIF'
                      }
                    </span>
                  </div>

                  <div className="timestamp">
                    Processed at {result.timestamp}
                  </div>

                  {/* Cloud Status Indicator */}
                  {result.location && (
                    <div style={{ 
                      fontSize: '12px', 
                      color: isAlreadyUploaded ? '#10b981' : '#6b7280',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginTop: '4px'
                    }}>
                      <Cloud size={12} />
                      {isAlreadyUploaded ? 'Uploaded to cloud' : 'Ready for upload'}
                    </div>
                  )}

                  <div className="predictions">
                    <h4 className="predictions-title">Predictions:</h4>
                    {result.predictions
                      .sort((a, b) => {
                        if (a.className.toLowerCase().includes('mango')) return -1;
                        if (b.className.toLowerCase().includes('mango')) return 1;
                        return b.probability - a.probability;
                      })
                      .slice(0, 3)
                      .map((prediction, index) => (
                        <div key={index} className="prediction-item">
                          <span className="prediction-name">{prediction.className}</span>
                          <div className="prediction-score">
                            <div className="progress-bar">
                              <div
                                className="progress-fill"
                                style={{ 
                                  width: `${prediction.probability * 100}%`,
                                  backgroundColor: prediction.className.toLowerCase().includes('mango')
                                    ? prediction.probability > 0.5 ? '#10b981' : '#f59e0b'
                                    : '#6b7280'
                                }}
                              ></div>
                            </div>
                            <span className="probability">
                              {(prediction.probability * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Empty State */}
      {imageResults.length === 0 && !isProcessing && (
        <div className="empty-state">
          <AlertCircle size={64} className="empty-icon" />
          <h3 className="empty-title">No images uploaded yet</h3>
          <p className="empty-description">
            Upload some images to see classification results, check for nearby duplicates, and save to cloud storage.
          </p>
        </div>
      )}

      {/* Loading State */}
      {(isProcessing || isCheckingDuplicates || isCloudUploading || isBulkSaving) && (
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">
            {isProcessing ? 'Processing images...' : 
             isCheckingDuplicates ? 'Checking for nearby duplicates...' :
             isCloudUploading ? 'Uploading to cloud...' :
             isBulkSaving ? 'Bulk saving to cloud...' : 'Loading...'}
          </p>
        </div>
      )}

      {/* Instructions */}
      <div className="instructions">
        <h4 className="instructions-title">Instructions:</h4>
        <ul className="instructions-list">
          <li>• Choose between Teachable Machine (with fallback) or MobileNetV2 models</li>
          <li>• Teachable Machine runs locally with fallback to mock model if URL invalid</li>
          <li>• MobileNetV2 uses backend API for classification</li>
          <li>• Upload images with GPS location data for classification and cloud storage</li>
          <li>• Images with GPS data are sent to backend for proximity checking</li>
          <li>• Duplicate resolution options appear for images within 1 meter</li>
          <li>• <strong>NEW:</strong> Individual cloud upload buttons on each image with GPS data</li>
          <li>• <strong>NEW:</strong> Bulk save approved images to Cloudinary after resolving duplicates</li>
          <li>• <strong>NEW:</strong> View cloud storage records and access uploaded images</li>
          <li>• Update MODEL_URL with your actual Teachable Machine model URL</li>
          <li>• Each image can be removed individually using the X button</li>
          <li>• Make sure your backend is running on localhost:8000 with Cloudinary configured</li>
        </ul>
      </div>

      {/* Cloud Storage Setup Info */}
      <div style={{ 
        marginTop: '24px', 
        padding: '16px', 
        backgroundColor: '#f8fafc', 
        borderRadius: '8px', 
        border: '1px solid #e2e8f0' 
      }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
          🔧 Cloud Storage Setup (Backend):
        </h4>
        <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.4' }}>
          <div>1. Sign up for free Cloudinary account at https://cloudinary.com</div>
          <div>2. Set environment variables: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET</div>
          <div>3. Install dependencies: pip install cloudinary pillow</div>
          <div>4. Images uploaded get GPS metadata and are accessible via generated URLs</div>
        </div>
      </div>
    </div>
  );
};

export default TeachableMachineImageClassifier;
