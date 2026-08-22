; case display-042-array
; expect exit=0 stdout="[\"\"]\n"
.func main arity=0 locals=0
  PUSH_STR ""
  NEW_ARRAY 1
  PRINT
  RET
.end
