; case strops-041-indexof
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_STR "abcabc"
  PUSH_STR "cab"
  INDEXOF
  PRINT
  RET
.end
