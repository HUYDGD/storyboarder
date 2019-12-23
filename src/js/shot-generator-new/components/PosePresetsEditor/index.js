import { remote } from 'electron'
import { useState, useEffect, useMemo, forwardRef, useRef } from 'react'
import { connect } from 'react-redux'
import prompt from 'electron-prompt'
import * as THREE from 'three'
window.THREE = THREE

// for pose harvesting (maybe abstract this later?)
import { machineIdSync } from 'node-machine-id'
import pkg from '../../../../../package.json'
import request from 'request'
import { FixedSizeGrid } from 'react-window'
import {
  updateObject,
  createPosePreset,
  getSceneObjects
} from '../../../shared/reducers/shot-generator'

import defaultPosePresets from '../../../shared/reducers/shot-generator-presets/poses.json'
import presetsStorage from '../../../shared/store/presetsStorage'

import { searchPresetsForTerms } from '../../utils/searchPresetsForTerms' 
import { NUM_COLS, GUTTER_SIZE, ITEM_WIDTH, ITEM_HEIGHT, CHARACTER_MODEL } from './ItemSettings'
import ListItem from './ListItem'
import { filepathFor } from '../../utils/filepathFor'

const shortId = id => id.toString().substr(0, 7).toLowerCase()

const PosePresetsEditor = connect(
  state => ({
    attachments: state.attachments,
    posePresets: state.presets.poses,
  }),
  {
    updateObject,
    createPosePreset,
    getSceneObjects,
    withState: (fn) => (dispatch, getState) => fn(dispatch, getState())
  }
)(
React.memo(({
  id,
  posePresetId,

  posePresets,
  attachments,

  updateObject,
  createPosePreset,
  withState
}) => {
  const thumbnailRenderer = useRef()

  const [ready, setReady] = useState(false)
  const [terms, setTerms] = useState(null)

  const presets = useMemo(() => searchPresetsForTerms(Object.values(posePresets), terms), [posePresets, terms])

  useEffect(() => {
    if (ready) return
    let filepath = filepathFor(CHARACTER_MODEL)
    if (attachments[filepath] && attachments[filepath].value) {
      setTimeout(() => {
        setReady(true)
      }, 100) // slight delay for snappier character selection via click
    }
  }, [attachments])


  const onChange = event => {
    event.preventDefault()
    setTerms(event.currentTarget.value)
  }

  const onCreatePosePreset = event => {
    event.preventDefault()

    // show a prompt to get the desired preset name
    let win = remote.getCurrentWindow()
    prompt({
      title: 'Preset Name',
      label: 'Select a Preset Name',
      value: `Pose ${shortId(THREE.Math.generateUUID())}`
    }, win).then(name => {
      if (name != null && name != '' && name != ' ') {
        withState((dispatch, state) => {
          // get the latest skeleton data
          let sceneObject = getSceneObjects(state)[id]
          let skeleton = sceneObject.skeleton
          let model = sceneObject.model

          // create a preset out of it
          let newPreset = {
            id: THREE.Math.generateUUID(),
            name,
            keywords: name, // TODO keyword editing
            state: {
              skeleton: skeleton || {}
            },
            priority: 0
          }

          // add it to state
          createPosePreset(newPreset)

          // save to server
          // for pose harvesting (maybe abstract this later?)
          request.post('https://storyboarders.com/api/create_pose', {
            form: {
              name: name,
              json: JSON.stringify(skeleton),
              model_type: model,
              storyboarder_version: pkg.version,
              machine_id: machineIdSync()
            }
          })

          // select the preset in the list
          updateObject(id, { posePresetId: newPreset.id })

          // get updated state (with newly created pose preset)
          withState((dispatch, state) => {
            // ... and save it to the presets file
            let denylist = Object.keys(defaultPosePresets)
            let filteredPoses = Object.values(state.presets.poses)
              .filter(pose => denylist.includes(pose.id) === false)
              .reduce(
                (coll, pose) => {
                  coll[pose.id] = pose
                  return coll
                },
                {}
              )
            presetsStorage.savePosePresets({ poses: filteredPoses })
          })
        })
      }
    }).catch(err =>
      console.error(err)
    )
  }

  const innerElementType = forwardRef(({ style, ...rest }, ref) => {
    let newStyle = {
      width:288,
      position:'relative',
      overflow:'hidden',
      ...style
    }
    return <div
        ref={ref}
        style={newStyle}
        {...rest}/>
  })

  return ready && <div className="thumbnail-search column">
      <div className="row" style={{ padding: '6px 0' } }> 
         <div className="column" style={{ flex: 1 }}> 
          <input placeholder='Search for a pose …'
                 onChange={onChange}/>
        </div>
        <div className="column" style={{ marginLeft: 5 }}> 
          <a className="button_add" href="#"
            style={{ width: 30, height: 34 }}
            onPointerDown={onCreatePosePreset}
          >+</a>
        </div>
      </div> 
      
      <div className="thumbnail-search__list">
       <FixedSizeGrid 
          columnCount={ NUM_COLS }
          columnWidth={ ITEM_WIDTH + GUTTER_SIZE }

          rowCount={ Math.ceil(presets.length / 4) }
          rowHeight={ ITEM_HEIGHT }
          width={ 288 }
          height={ 363 }
          innerElementType={ innerElementType }
          itemData={{
            presets,

            id: id,
            posePresetId: posePresetId,

            attachments,
            updateObject,

            thumbnailRenderer
          }}
          children={ ListItem }/>
      </div>
    </div> 
}))

export default PosePresetsEditor
