; case globals-010-holdsarray
; expect exit=0 stdout="[1, 2, 3]\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  STORE_GLOBAL arr
  LOAD_GLOBAL arr
  PUSH_INT 3
  ARR_PUSH
  LOAD_GLOBAL arr
  PRINT
  RET
.end
