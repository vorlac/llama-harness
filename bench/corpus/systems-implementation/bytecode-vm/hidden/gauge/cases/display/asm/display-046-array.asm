; case display-046-array
; expect exit=0 stdout="[\"q\\\"q\"]\n"
.func main arity=0 locals=0
  PUSH_STR "q\"q"
  NEW_ARRAY 1
  PRINT
  RET
.end
